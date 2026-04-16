import { AirtableClient } from './airtable';
import type { SecurityLogFields } from './types';

/** Fire-and-forget security log to Airtable via waitUntil */
export function logSecurity(
  ctx: ExecutionContext,
  airtable: AirtableClient,
  fields: SecurityLogFields
): void {
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

/** Get client IP from request headers (Cloudflare-aware) */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
