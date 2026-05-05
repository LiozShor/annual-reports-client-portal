/**
 * DL-402 Telegram Ops Bot — domain types and use-case interfaces.
 *
 * This module is the inner layer of the bot. It MUST NOT import:
 *   - Cloudflare runtime types (KVNamespace, Env, ExecutionContext)
 *   - Vendor SDKs (Anthropic, Telegram)
 *   - Anything from src/routes/* or src/lib/* outside this folder
 *
 * The four interfaces below are the seams. Production adapters live in
 * sibling files; tests inject in-memory fakes that satisfy the same shapes.
 */

// ─── Telegram update shape (subset we care about) ────────────────────────────

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// ─── Inline keyboard for the M2 confirm flow (declared in M1 for type stability) ─

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

// ─── Anthropic tool-use protocol shapes (subset; mirrors API JSON) ──────────

export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type AnthropicStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | string;

export interface AnthropicCompletion {
  id: string;
  stop_reason: AnthropicStopReason;
  content: AnthropicContentBlock[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Tool registry shapes ────────────────────────────────────────────────────

export interface ToolContext {
  /**
   * Authenticated Telegram user id (the bot caller). Used for activity logs.
   * Pre-validated against the allow-list before any tool runs.
   */
  actorId: number;
  /** request_id threaded through activity-logger. */
  requestId: string;
}

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: AnthropicToolSchema['input_schema'];
  /**
   * `requiresConfirm: true` flips the loop into "register pending action,
   * post inline keyboard, return tool_result {pending: true}" instead of
   * executing. Read-only tools default to false. M1 has none. M2/M3 set true.
   */
  requiresConfirm: boolean;
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolResult {
  /** Stringified payload that becomes the tool_result.content for Claude. */
  content: string;
  /** True only for tool errors the model should retry / explain. */
  isError?: boolean;
}

// ─── Use-case interfaces (the four seams) ────────────────────────────────────

/**
 * Outbound Telegram surface — what the bot needs to talk back to users.
 * Production = Telegram Bot API HTTP client. Tests = in-memory recorder.
 */
export interface BotMessenger {
  sendMessage(args: {
    chatId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
    /** Always 'HTML' in this project — Hebrew + special chars handle better. */
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<{ messageId: number }>;

  editMessageText(args: {
    chatId: number;
    messageId: number;
    text: string;
    replyMarkup?: InlineKeyboardMarkup;
    parseMode?: 'HTML' | 'MarkdownV2';
  }): Promise<void>;

  /**
   * MUST be called for every callback_query, even with no text/url, or the
   * Telegram client hangs on the loading spinner.
   */
  answerCallbackQuery(args: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<void>;

  /** Returns a downloadable HTTPS URL for a Telegram-hosted file. */
  getFileUrl(fileId: string): Promise<string>;

  /** Optional UX touch — "typing…" indicator. Best-effort, never throws. */
  sendChatAction(args: { chatId: number; action: 'typing' | 'upload_document' }): Promise<void>;
}

/**
 * Per-chat rolling history. Production = KV-backed. Tests = Map.
 * Trim policy is enforced in the implementation, not at call sites.
 */
export interface ChatHistoryStore {
  read(chatId: number): Promise<AnthropicMessage[]>;
  write(chatId: number, messages: AnthropicMessage[]): Promise<void>;
  clear(chatId: number): Promise<void>;
}

/**
 * Pending-action token store for the M2 confirm flow. Declared in M1 so the
 * interface set is stable; loop.ts will gate on `requiresConfirm` only when
 * write tools land in M2.
 */
export interface ConfirmTokenStore {
  register(action: { toolName: string; args: Record<string, unknown>; chatId: number }): Promise<string>;
  consume(token: string): Promise<{ toolName: string; args: Record<string, unknown>; chatId: number } | null>;
}

/**
 * LLM seam — the loop only knows "send messages + tools, get a completion".
 * Production = Anthropic Messages API. Tests = scripted responder.
 */
export interface LlmClient {
  complete(args: {
    system: string;
    messages: AnthropicMessage[];
    tools: AnthropicToolSchema[];
    maxTokens?: number;
  }): Promise<AnthropicCompletion>;
}

// ─── Constants (single source of truth — no magic strings elsewhere) ─────────

export const KV_KEYS = {
  history: (chatId: number) => `telegram:chat:${chatId}`,
  confirm: (token: string) => `telegram:confirm:${token}`,
  rate: (yyyymmdd: string) => `telegram:rate:${yyyymmdd}`,
} as const;

export const TTL_SECONDS = {
  history: 60 * 60 * 24 * 7, // 7d
  confirm: 60 * 5, // 5min
  rate: 60 * 60 * 36, // 36h covers timezone edges
} as const;

export const HISTORY_TURN_CAP = 10;

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

export const TELEGRAM_MAX_MESSAGE_BYTES = 4096;
