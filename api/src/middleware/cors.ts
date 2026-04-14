import { cors } from 'hono/cors';
import type { Env } from '../lib/types';

/**
 * CORS middleware factory — scoped to the allowed origin.
 * Replaces per-node CORS headers from n8n Respond to Webhook nodes.
 */
export function corsMiddleware(origin: string) {
  return cors({
    origin,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // Cache preflight for 24 hours
  });
}
