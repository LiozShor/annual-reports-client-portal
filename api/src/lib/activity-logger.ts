/**
 * Activity logger — structured event emission for Cloudflare Workers Logs.
 *
 * Emits a single JSON line per event via console.* so that CF Workers Logs
 * can auto-index every field (event_type, category, request_id, client_id, etc.).
 *
 * PII contract:
 *   - actor_ip  → zeroed to /24 via redactIp()
 *   - details   → key-drop + text-scrub via sanitizeDetails()
 *   - error.*   → scrubText() on message + stack
 *
 * Pure function: no network calls, no storage writes.
 * MUST NOT throw — any internal failure falls back to a minimal console.error line.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { redactIp, sanitizeDetails, scrubText } from './pii';

// ─── Request-scoped R2 buffer (AsyncLocalStorage) ────────────────────────────

const _als = new AsyncLocalStorage<ActivityEvent[]>();

/** Run fn inside a fresh event buffer. Returns the buffer after fn resolves. */
export async function withEventBuffer<T>(fn: () => Promise<T>): Promise<{ result: T; events: ActivityEvent[] }> {
  const buf: ActivityEvent[] = [];
  const result = await _als.run(buf, fn);
  return { result, events: buf };
}

// ─── Public types ────────────────────────────────────────────────────────────

export type EventCategory =
  | 'AUTH'
  | 'INBOUND'
  | 'AI'
  | 'ADMIN'
  | 'CLIENT'
  | 'EMAIL'
  | 'WORKFLOW'
  | 'ERROR';

export type EventSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export type EventSource = 'worker' | 'n8n' | 'admin-ui' | 'client-portal';

export interface ActivityEventInput {
  /** e.g. 'auth_success', 'doc_approve', 'tab_switch' */
  event_type: string;
  category: EventCategory;
  /** @default 'INFO' */
  severity?: EventSeverity;
  /** @default 'worker' */
  source?: EventSource;
  /** If absent, generated via crypto.randomUUID(). */
  request_id?: string;
  /** 'admin' | 'system' | client recId | 'cpa-204' */
  actor?: string;
  /** Raw IP — will be redacted to /24 before logging. */
  actor_ip?: string;
  /** Opaque Airtable recXXX — not PII. */
  client_id?: string;
  /** e.g. 'POST /webhook/approve-and-send' */
  endpoint?: string;
  duration_ms?: number;
  status?: number;
  /** Free-form payload; sanitized before logging. */
  details?: unknown;
  error?: {
    category?: string;
    message: string;
    stack?: string;
  };
}

export interface ActivityEvent
  extends Omit<ActivityEventInput, 'details' | 'actor_ip'> {
  /** ISO 8601 timestamp, set automatically. */
  ts: string;
  request_id: string;
  severity: EventSeverity;
  source: EventSource;
  /** Marker: this event has been sanitized. */
  pii_safe: true;
  /** Redacted /24 version of actor_ip. */
  actor_ip?: string;
  /** Sanitized free-form payload. */
  details?: Record<string, unknown>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convenience: generate a new request ID to thread through multiple logEvent
 * calls in the same request.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Build, sanitize, emit, and return a structured activity event.
 *
 * Severity routing:
 *   INFO     → console.log
 *   WARN     → console.warn
 *   ERROR    → console.error
 *   CRITICAL → console.error  (CF dashboard severity derives from console.* level)
 *
 * The emitted line is: console.{level}(JSON.stringify(event))
 * — the ENTIRE event object becomes the log line, no prefix.
 *
 * Cheap enough to call inside ctx.waitUntil() on every request.
 * MUST NOT throw.
 */
export function logEvent(input: ActivityEventInput): ActivityEvent {
  try {
    const severity: EventSeverity = input.severity ?? 'INFO';
    const source: EventSource = input.source ?? 'worker';
    const request_id: string = input.request_id ?? crypto.randomUUID();
    const ts: string = new Date().toISOString();

    // Sanitize actor_ip → /24
    const redactedIp = redactIp(input.actor_ip);

    // Sanitize error fields
    const sanitizedError = input.error
      ? {
          ...(input.error.category !== undefined
            ? { category: input.error.category }
            : {}),
          message: scrubText(input.error.message) ?? '',
          ...(input.error.stack !== undefined
            ? { stack: scrubText(input.error.stack) }
            : {}),
        }
      : undefined;

    // Sanitize free-form details
    const sanitizedDetails = sanitizeDetails(input.details);

    // Build the final event object
    const event: ActivityEvent = {
      ts,
      request_id,
      event_type: input.event_type,
      category: input.category,
      severity,
      source,
      pii_safe: true,
      // Optional fields — only include when present
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      ...(redactedIp !== undefined ? { actor_ip: redactedIp } : {}),
      ...(input.client_id !== undefined ? { client_id: input.client_id } : {}),
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      ...(input.duration_ms !== undefined
        ? { duration_ms: input.duration_ms }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(sanitizedDetails !== undefined
        ? { details: sanitizedDetails }
        : {}),
      ...(sanitizedError !== undefined ? { error: sanitizedError } : {}),
    };

    // Emit to CF Workers Logs
    const line = JSON.stringify(event);
    if (severity === 'WARN') {
      console.warn(line);
    } else if (severity === 'ERROR' || severity === 'CRITICAL') {
      console.error(line);
    } else {
      console.log(line);
    }

    // Push into the per-request buffer if one is active
    _als.getStore()?.push(event);

    return event;
  } catch (err: unknown) {
    // Fallback: never throw — emit a minimal failure marker
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ event_type: 'logger_failure', error: msg })
    );
    // Return a minimal valid event so callers that chain on the return value don't crash
    return {
      ts: new Date().toISOString(),
      request_id: input.request_id ?? 'unknown',
      event_type: 'logger_failure',
      category: input.category,
      severity: 'ERROR',
      source: input.source ?? 'worker',
      pii_safe: true,
    };
  }
}
