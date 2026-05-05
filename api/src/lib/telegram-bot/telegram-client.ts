/**
 * DL-402 BotMessenger adapter — thin Telegram Bot API HTTP client.
 *
 * Single responsibility: marshal calls to api.telegram.org and unwrap the
 * `{ ok, result }` envelope. No business logic. No knowledge of KV, Anthropic,
 * or our domain.
 */

import { TELEGRAM_MAX_MESSAGE_BYTES } from './types';
import type { BotMessenger, InlineKeyboardMarkup } from './types';

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramBotClient implements BotMessenger {
  constructor(private readonly botToken: string) {}

  async sendMessage(args: {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<{ messageId: number }> {
    const text = clampToTelegramLimit(args.text);
    const result = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: args.chatId,
      text,
      parse_mode: args.parseMode ?? 'HTML',
      reply_markup: args.replyMarkup,
      disable_web_page_preview: true,
    });
    return { messageId: result.message_id };
  }

  async editMessageText(args: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<void> {
    await this.call('editMessageText', {
      chat_id: args.chatId,
      message_id: args.messageId,
      text: clampToTelegramLimit(args.text),
      parse_mode: args.parseMode ?? 'HTML',
      reply_markup: args.replyMarkup,
    });
  }

  async answerCallbackQuery(args: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: args.callbackQueryId,
      text: args.text,
      show_alert: args.showAlert ?? false,
    });
  }

  async getFileUrl(fileId: string): Promise<string> {
    const result = await this.call<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!result.file_path) {
      throw new Error('telegram_getFile_no_path');
    }
    return `${TELEGRAM_API}/file/bot${this.botToken}/${result.file_path}`;
  }

  async sendChatAction(args: { chatId: number; action: 'typing' | 'upload_document' }): Promise<void> {
    try {
      await this.call('sendChatAction', { chat_id: args.chatId, action: args.action });
    } catch {
      // Best-effort UX; never fail the turn over a typing indicator.
    }
  }

  private async call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stripUndefined(body)),
    });
    const json = (await response.json()) as TelegramApiResponse<T>;
    if (!json.ok || json.result === undefined) {
      throw new Error(`telegram_${method}_failed: ${json.error_code ?? response.status} ${json.description ?? ''}`.trim());
    }
    return json.result;
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Telegram rejects sendMessage > 4096 chars. We truncate with an ellipsis
 * rather than throwing — the loop already aims for short replies, this is a
 * safety net for runaway tool_result content.
 */
function clampToTelegramLimit(text: string): string {
  if (text.length <= TELEGRAM_MAX_MESSAGE_BYTES) return text;
  const ellipsis = '\n…';
  return text.slice(0, TELEGRAM_MAX_MESSAGE_BYTES - ellipsis.length) + ellipsis;
}
