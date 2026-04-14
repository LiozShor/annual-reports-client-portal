import { cors } from 'hono/cors';
import type { Env } from '../lib/types';

/**
 * CORS middleware factory — scoped to allowed origins.
 * Accepts a comma-separated string of origins (from env var).
 * Replaces per-node CORS headers from n8n Respond to Webhook nodes.
 */
export function corsMiddleware(allowedOrigins: string) {
  const origins = allowedOrigins.split(',').map(o => o.trim());
  return cors({
    origin: origins,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // Cache preflight for 24 hours
  });
}
