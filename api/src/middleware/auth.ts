import type { Context, Next } from 'hono';
import { verifyToken } from '../lib/token';
import type { Env, TokenPayload } from '../lib/types';

// Hono Variables type for token context
type AuthVariables = { tokenPayload: TokenPayload };

/**
 * Token verification middleware for protected routes (Phase 2+).
 * Extracts Bearer token from Authorization header, verifies it,
 * and returns 401 JSON on failure.
 *
 * Usage: app.use('/webhook/admin-*', authMiddleware)
 * Skip for: /webhook/admin-auth (login endpoint itself)
 */
export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: AuthVariables }>,
  next: Next
) {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';

  if (!token) {
    return c.json({ ok: false, error: 'No token provided' }, 401);
  }

  const result = await verifyToken(token, c.env.SECRET_KEY);

  if (!result.valid) {
    return c.json({ ok: false, error: result.reason }, 401);
  }

  // Attach payload to context for downstream handlers
  c.set('tokenPayload', result.payload!);
  await next();
}
