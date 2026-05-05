/**
 * DL-402 — POST /webhook/telegram
 *
 * Pipeline:
 *   1. Verify X-Telegram-Bot-Api-Secret-Token (constant-time) → 401 on mismatch.
 *   2. Parse update; check from.id is in ADMIN_TELEGRAM_IDS allow-list.
 *      Unauthorized → 200 + silent drop (Telegram requires 200 to stop retries)
 *      + audit log.
 *   3. Hand off to bot composition root inside ctx.waitUntil so we ack Telegram
 *      within the recommended window even if Anthropic is slow.
 *
 * The route owns auth + telemetry. ALL business logic lives behind the
 * BotApp interface returned by buildBotApp(env).
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { timingSafeEqual } from '../lib/crypto';
import { logEvent, newRequestId } from '../lib/activity-logger';
import { buildBotApp } from '../lib/telegram-bot/composition';
import type { TelegramUpdate } from '../lib/telegram-bot/types';

const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const route = new Hono<{ Bindings: Env }>();

route.post('/telegram', async (c) => {
  const requestId = newRequestId();

  const providedSecret = c.req.header(TELEGRAM_SECRET_HEADER) ?? '';
  if (!c.env.TELEGRAM_WEBHOOK_SECRET || !timingSafeEqual(providedSecret, c.env.TELEGRAM_WEBHOOK_SECRET)) {
    logEvent({
      event_type: 'telegram_secret_mismatch',
      category: 'AUTH',
      severity: 'WARN',
      request_id: requestId,
      endpoint: 'POST /webhook/telegram',
      status: 401,
    });
    return c.json({ ok: false }, 401);
  }

  let update: TelegramUpdate;
  try {
    update = (await c.req.json()) as TelegramUpdate;
  } catch {
    logEvent({
      event_type: 'telegram_invalid_json',
      category: 'AUTH',
      severity: 'WARN',
      request_id: requestId,
      endpoint: 'POST /webhook/telegram',
      status: 400,
    });
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  const fromId = extractFromId(update);
  const allowed = parseAllowList(c.env.ADMIN_TELEGRAM_IDS);

  if (fromId === null || !allowed.has(fromId)) {
    logEvent({
      event_type: 'telegram_unauthorized',
      category: 'AUTH',
      severity: 'WARN',
      request_id: requestId,
      actor: fromId === null ? 'unknown' : String(fromId),
      endpoint: 'POST /webhook/telegram',
      status: 200,
    });
    // Always 200 to Telegram so it doesn't retry. The drop is silent on the
    // user side — they get no reply, which is the desired behavior for a
    // mistargeted bot.
    return c.json({ ok: true });
  }

  logEvent({
    event_type: 'telegram_inbound',
    category: 'ADMIN',
    request_id: requestId,
    actor: String(fromId),
    endpoint: 'POST /webhook/telegram',
    details: {
      kind: classifyUpdate(update),
      update_id: update.update_id,
    },
  });

  const bot = buildBotApp(c.env);

  c.executionCtx.waitUntil(
    bot.handleUpdate(update, { requestId }).catch((err) => {
      logEvent({
        event_type: 'telegram_handler_error',
        category: 'ERROR',
        severity: 'ERROR',
        request_id: requestId,
        actor: String(fromId),
        endpoint: 'POST /webhook/telegram',
        error: { message: (err as Error).message, stack: (err as Error).stack },
      });
    })
  );

  return c.json({ ok: true });
});

export default route;

// ─── helpers ────────────────────────────────────────────────────────────────

function extractFromId(update: TelegramUpdate): number | null {
  if (update.callback_query?.from?.id !== undefined) return update.callback_query.from.id;
  if (update.message?.from?.id !== undefined) return update.message.from.id;
  if (update.edited_message?.from?.id !== undefined) return update.edited_message.from.id;
  return null;
}

function parseAllowList(raw: string | undefined): Set<number> {
  if (!raw) return new Set();
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (!isNaN(n)) out.add(n);
  }
  return out;
}

function classifyUpdate(update: TelegramUpdate): string {
  if (update.callback_query) return 'callback_query';
  if (update.message?.document) return 'document';
  if (update.message?.photo) return 'photo';
  if (update.message?.text) return 'text';
  if (update.edited_message) return 'edited';
  return 'other';
}
