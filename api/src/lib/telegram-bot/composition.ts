/**
 * DL-402 — composition root for the Telegram ops bot.
 *
 * This is the ONLY file that imports both vendor adapters and use-case modules.
 * It wires concrete implementations into the four interfaces and returns a
 * `BotApp` the route can hand a `TelegramUpdate` to.
 *
 * Replacing any layer in tests = swap one constructor call here.
 */

import type { Env } from '../types';
import { AnthropicLlmClient } from './anthropic-client';
import { KvChatHistoryStore } from './history';
import { runChatTurn } from './loop';
import { buildSystemPrompt } from './system-prompt';
import { TelegramBotClient } from './telegram-client';
import { buildToolRegistry } from './tools';
import { WorkerApiClient } from './worker-api-client';
import type { TelegramUpdate, ToolContext } from './types';

export interface BotApp {
  handleUpdate(update: TelegramUpdate, ctx: { requestId: string }): Promise<void>;
}

export function buildBotApp(env: Env): BotApp {
  const messenger = new TelegramBotClient(env.TELEGRAM_BOT_TOKEN);
  const llm = new AnthropicLlmClient(env.ANTHROPIC_API_KEY);
  const history = new KvChatHistoryStore(env.CACHE_KV);
  const api = new WorkerApiClient(env.SELF, env.SECRET_KEY);
  const tools = buildToolRegistry({ api });

  return {
    async handleUpdate(update, runCtx) {
      // M1 only handles plain text messages. callback_query and document
      // updates land in M2 / M3 — short-circuit with a friendly notice.
      const message = update.message ?? update.edited_message;

      if (update.callback_query) {
        await messenger.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: 'M1: write actions arrive in milestone 2. Coming soon.',
        });
        return;
      }

      if (!message) {
        // Nothing actionable; ack is sufficient (Telegram only needs 200).
        return;
      }

      const chatId = message.chat.id;
      const actorId = message.from?.id;
      if (actorId === undefined) return;

      if (message.document || (message.photo && message.photo.length > 0)) {
        await messenger.sendMessage({
          chatId,
          text: 'M1: I can answer questions, but inbound document routing arrives in milestone 3.',
        });
        return;
      }

      const text = (message.text ?? '').trim();
      if (!text) return;

      const todayIsraelDate = formatIsraelDate(new Date());
      const systemPrompt = buildSystemPrompt({
        callerLanguageCode: message.from?.language_code,
        todayIsraelDate,
      });

      const toolCtx: ToolContext = {
        actorId,
        requestId: runCtx.requestId,
      };

      await runChatTurn(
        { llm, messenger, history, tools, systemPrompt },
        { chatId, text, ctx: toolCtx }
      );
    },
  };
}

/** "YYYY-MM-DD" in Asia/Jerusalem — pure, no external lib. */
function formatIsraelDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d);
}
