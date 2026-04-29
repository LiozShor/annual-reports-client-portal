import { AirtableClient } from './airtable';
import { logEvent, type EventCategory, type EventSeverity } from './activity-logger';
import type { Env, SecurityLogFields } from './types';

/**
 * Map an Airtable security_logs event_type to an activity-logger category.
 * Anything unmatched falls back to 'AUTH' (the original use of this sink).
 */
function mapCategory(event_type: string): EventCategory {
  const t = event_type.toUpperCase();
  if (t === 'WORKER_ERROR' || t.endsWith('_ERROR')) return 'ERROR';
  if (t.startsWith('AUTH_') || t.startsWith('TOKEN_')) return 'AUTH';
  if (t.startsWith('INBOUND_')) return 'INBOUND';
  if (t.startsWith('AI_') || t.includes('CLASSIF')) return 'AI';
  if (t.startsWith('CLIENT_') || t.startsWith('PORTAL_')) return 'CLIENT';
  if (t.startsWith('EMAIL_') || t.includes('REMINDER')) return 'EMAIL';
  if (t.startsWith('N8N_') || t.startsWith('WORKFLOW_')) return 'WORKFLOW';
  return 'ADMIN';
}

/** Map Airtable severity ('INFO' | 'WARNING' | 'ERROR') → activity-logger severity. */
function mapSeverity(s: SecurityLogFields['severity']): EventSeverity {
  if (s === 'WARNING') return 'WARN';
  return s; // 'INFO' | 'ERROR' pass through
}

/**
 * Fire-and-forget security log.
 *
 * DL-365 Phase 2: dual-write — always emits a structured activity event via
 * logEvent() (no env flag needed; pure console.log). The legacy Airtable
 * security_logs POST is gated by env.LEGACY_LOG_TO_AIRTABLE !== 'false'
 * so we can flip it off after the 2-week dual-write window without redeploying
 * caller code.
 */
export function logSecurity(
  ctx: ExecutionContext,
  env: Env,
  airtable: AirtableClient,
  fields: SecurityLogFields,
  request_id?: string
): void {
  // 1. Always emit structured event (DL-365)
  let parsedDetails: unknown = undefined;
  if (fields.details) {
    try {
      parsedDetails = JSON.parse(fields.details);
    } catch {
      parsedDetails = { raw: fields.details };
    }
  }
  logEvent({
    event_type: fields.event_type.toLowerCase(),
    category: mapCategory(fields.event_type),
    severity: mapSeverity(fields.severity),
    source: 'worker',
    request_id,
    actor: fields.actor,
    actor_ip: fields.actor_ip,
    endpoint: fields.endpoint,
    status: fields.http_status,
    details: parsedDetails,
    error: fields.error_message
      ? { message: fields.error_message }
      : undefined,
  });

  // 2. Dual-write to Airtable security_logs (legacy)
  if (env.LEGACY_LOG_TO_AIRTABLE !== 'false') {
    ctx.waitUntil(
      airtable
        .createRecords(
          'security_logs',
          [{ fields: fields as unknown as Record<string, unknown> }],
          { typecast: true }
        )
        .catch(() => { /* fire-and-forget */ })
    );
  }
}

/** Get client IP from request headers (Cloudflare-aware) */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
