import { Hono } from 'hono';
import { generateAdminToken, verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { logSecurity, getClientIp } from '../lib/security-log';
import type { Env } from '../lib/types';

const auth = new Hono<{ Bindings: Env }>();

// POST /webhook/admin-auth — Login
auth.post('/admin-auth', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  let password: string;
  try {
    const body = await c.req.json<{ password?: string }>();
    password = body.password || '';
  } catch {
    return c.json({ ok: false, error: 'Invalid request body' });
  }

  // Verify password
  if (password !== c.env.ADMIN_PASSWORD) {
    logSecurity(c.executionCtx, airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'AUTH_FAIL',
      severity: 'WARNING',
      actor: 'admin-attempt',
      actor_ip: clientIp,
      endpoint: '/webhook/admin-auth',
      http_status: 200,
      error_message: 'Invalid password',
    });

    return c.json({ ok: false, error: 'Invalid password' });
  }

  // Generate token (8-hour expiry)
  const token = await generateAdminToken(c.env.SECRET_KEY);

  logSecurity(c.executionCtx, airtable, {
    timestamp: new Date().toISOString(),
    event_type: 'AUTH_SUCCESS',
    severity: 'INFO',
    actor: 'admin',
    actor_ip: clientIp,
    endpoint: '/webhook/admin-auth',
    http_status: 200,
  });

  return c.json({ ok: true, token });
});

// GET /webhook/admin-verify — Token verification
auth.get('/admin-verify', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  // Extract token: Authorization header first, query param fallback
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : c.req.query('token') || '';

  const result = await verifyToken(token, c.env.SECRET_KEY);

  if (!result.valid) {
    const eventType = result.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';

    logSecurity(c.executionCtx, airtable, {
      timestamp: new Date().toISOString(),
      event_type: eventType,
      severity: 'WARNING',
      actor: 'admin-token',
      actor_ip: clientIp,
      endpoint: '/webhook/admin-verify',
      http_status: 200,
      error_message: result.reason || '',
    });
  }

  return c.json({ ok: result.valid });
});

export default auth;
