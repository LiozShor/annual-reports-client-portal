// Environment bindings for Cloudflare Workers
export interface Env {
  // Secrets (set via `wrangler secret put`)
  ADMIN_PASSWORD: string;
  SECRET_KEY: string;
  CLIENT_SECRET_KEY: string;
  AIRTABLE_PAT: string;

  // MS Graph OAuth2 secrets (Phase 4)
  MS_GRAPH_CLIENT_ID: string;
  MS_GRAPH_CLIENT_SECRET: string;
  MS_GRAPH_TENANT_ID: string;
  MS_GRAPH_REFRESH_TOKEN: string;

  // Worker→n8n internal webhook key (Phase 5)
  N8N_INTERNAL_KEY: string;

  // Approval token secret for approve-and-send (Phase 7)
  APPROVAL_SECRET: string;

  // Anthropic API key for AI chat proxy (Phase 9)
  ANTHROPIC_API_KEY: string;

  // DL-402 Telegram ops bot
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  /** Comma-separated allow-list of Telegram user IDs (numbers). */
  ADMIN_TELEGRAM_IDS: string;
  /** Base URL for Worker self-calls from the bot (read tools wrap existing routes). */
  WORKER_BASE_URL?: string;

  // Alert email for error notifications (Phase 6)
  ALERT_EMAIL: string;

  // DL-365 activity logger
  ACTIVITY_LOGS: R2Bucket;
  DEV_PASSWORD: string;
  PII_HASH_KEY: string;
  // DL-365 Phase 3: CF Logs Analytics API (Workers Logs:Read scope)
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;

  // KV namespaces
  TOKEN_CACHE: KVNamespace;
  CACHE_KV: KVNamespace;

  // D1 database for bot agent memory (created 2026-05-05).
  AGENT_MEMORY: D1Database;

  // Queue producer binding (Phase: Cloudflare Queues migration)
  INBOUND_QUEUE: Queue<InboundQueueMessage>;

  // DL-402: self-binding for Telegram bot tools (CF blocks public-URL self-fetch).
  SELF: Fetcher;

  // Vars (set in wrangler.toml [vars])
  ALLOWED_ORIGIN: string;
  AIRTABLE_BASE_ID: string;

  // Feature flags
  USE_QUEUE?: string;
  /** DL-365 Phase 2: when 'false', skip Airtable security_logs dual-write. Default: dual-write enabled. */
  LEGACY_LOG_TO_AIRTABLE?: string;
}

// Message shape for the inbound email queue. Mirrors InboundEmailRequest
// from lib/inbound/types.ts; change_type is optional here because the
// producer route tolerates missing values and defaults downstream.
export interface InboundQueueMessage {
  message_id: string;
  change_type?: string;
}

// Standard API response shape (matches n8n webhook responses)
export interface ApiResponse {
  ok: boolean;
  error?: string;
}

export interface AuthResponse extends ApiResponse {
  token?: string;
}

// Token payload
export interface TokenPayload {
  exp: number;
  iat: number;
  type: 'admin';
}

// Token verification result
export interface TokenVerifyResult {
  valid: boolean;
  payload?: TokenPayload;
  reason?: 'TOKEN_INVALID' | 'TOKEN_EXPIRED';
}

// Client token verification result
export interface ClientTokenVerifyResult {
  valid: boolean;
  reason?: 'INVALID_TOKEN' | 'TOKEN_EXPIRED';
}

// Airtable security log fields
export interface SecurityLogFields {
  timestamp: string;
  event_type: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
  actor: string;
  actor_ip: string;
  endpoint: string;
  http_status: number;
  error_message?: string;
  details?: string;
}
