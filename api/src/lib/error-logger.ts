import { AirtableClient } from './airtable';
import { MSGraphClient } from './ms-graph';
import { logSecurity } from './security-log';
import { logEvent } from './activity-logger';
import type { Env } from './types';

export type ErrorCategory = 'DEPENDENCY' | 'VALIDATION' | 'INTERNAL';

/**
 * Escape HTML special characters to prevent XSS.
 */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COOLDOWN_MINUTES: Record<ErrorCategory, number> = {
  DEPENDENCY: 30,
  VALIDATION: 15,
  INTERNAL: 15,
};

/**
 * Log an error to Airtable security_logs and send a throttled alert email.
 * All side effects are fire-and-forget via waitUntil — never blocks the response.
 */
export function logError(
  ctx: ExecutionContext,
  env: Env,
  opts: {
    endpoint: string;
    error: Error | unknown;
    category?: ErrorCategory;
    details?: string;
    request_id?: string;
  }
): void {
  const category: ErrorCategory = opts.category ?? 'INTERNAL';
  const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const stack = opts.error instanceof Error ? opts.error.stack : undefined;

  // DL-365 Phase 2: emit structured event synchronously (pure console.log, no I/O).
  logEvent({
    event_type: 'worker_error',
    category: 'ERROR',
    severity: 'ERROR',
    source: 'worker',
    request_id: opts.request_id,
    endpoint: opts.endpoint,
    error: { category, message, stack },
    details: opts.details ? { details: opts.details } : undefined,
  });

  ctx.waitUntil(
    (async () => {
      const airtable = new AirtableClient(env.AIRTABLE_PAT, env.AIRTABLE_BASE_ID);

      // 1. Log to Airtable security_logs (gated by env.LEGACY_LOG_TO_AIRTABLE inside logSecurity)
      await logSecurityError(ctx, env, airtable, opts.endpoint, message, category, opts.details, opts.request_id);

      // 2. Send throttled alert email
      await maybeSendAlert(ctx, env, opts.endpoint, message, category);
    })().catch(() => {
      /* fire-and-forget — never throw */
    })
  );
}

async function logSecurityError(
  ctx: ExecutionContext,
  env: Env,
  airtable: AirtableClient,
  endpoint: string,
  message: string,
  category: ErrorCategory,
  details?: string,
  request_id?: string
): Promise<void> {
  logSecurity(ctx, env, airtable, {
    timestamp: new Date().toISOString(),
    event_type: 'WORKER_ERROR',
    severity: 'ERROR',
    actor: 'worker',
    actor_ip: 'internal',
    endpoint,
    http_status: 500,
    error_message: message,
    details: details ?? category,
  }, request_id);
}

async function maybeSendAlert(
  ctx: ExecutionContext,
  env: Env,
  endpoint: string,
  message: string,
  category: ErrorCategory
): Promise<void> {
  // Sanitize endpoint for KV key (replace slashes/colons with underscores)
  const safeEndpoint = endpoint.replace(/[/:]/g, '_');
  const throttleKey = `alert:${category}:${safeEndpoint}`;

  // Check cooldown
  const existing = await env.CACHE_KV.get(throttleKey);
  if (existing !== null) return; // Still in cooldown — skip alert

  // Set cooldown BEFORE sending to prevent race conditions
  const ttlSeconds = COOLDOWN_MINUTES[category] * 60;
  await env.CACHE_KV.put(throttleKey, '1', { expirationTtl: ttlSeconds });

  // Send alert email if ALERT_EMAIL is configured
  const alertEmail = env.ALERT_EMAIL;
  if (!alertEmail) return;

  const msGraph = new MSGraphClient(env, ctx);
  const timestamp = new Date().toISOString();
  const html = `
<div style="font-family: sans-serif; max-width: 600px;">
  <h2 style="color: #dc2626;">⚠️ Worker Error Alert</h2>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 8px; font-weight: bold; background: #f3f4f6;">Endpoint</td><td style="padding: 8px;">${escHtml(endpoint)}</td></tr>
    <tr><td style="padding: 8px; font-weight: bold; background: #f3f4f6;">Category</td><td style="padding: 8px;">${escHtml(category)}</td></tr>
    <tr><td style="padding: 8px; font-weight: bold; background: #f3f4f6;">Error</td><td style="padding: 8px; color: #dc2626;">${escHtml(message)}</td></tr>
    <tr><td style="padding: 8px; font-weight: bold; background: #f3f4f6;">Timestamp</td><td style="padding: 8px;">${timestamp}</td></tr>
  </table>
  <p style="color: #6b7280; font-size: 12px;">Next alert for this error suppressed for ${COOLDOWN_MINUTES[category]} minutes.</p>
</div>`;

  await msGraph.sendMail(
    `[Worker Error] ${category}: ${endpoint}`,
    html,
    alertEmail,
    'reports@moshe-atsits.co.il'
  );
}
