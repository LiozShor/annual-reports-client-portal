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

  // Alert email for error notifications (Phase 6)
  ALERT_EMAIL: string;

  // KV namespaces
  TOKEN_CACHE: KVNamespace;
  CACHE_KV: KVNamespace;

  // Queue producer binding (Phase: Cloudflare Queues migration)
  INBOUND_QUEUE: Queue<InboundQueueMessage>;

  // Vars (set in wrangler.toml [vars])
  ALLOWED_ORIGIN: string;
  AIRTABLE_BASE_ID: string;

  // Feature flags
  USE_QUEUE?: string;
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
