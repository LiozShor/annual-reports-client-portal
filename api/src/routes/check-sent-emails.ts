// TEMPORARY ENDPOINT — added 2026-04-12 for batch send verification.
// Remove once outbound email logging is implemented.

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { MSGraphClient } from '../lib/ms-graph';
import type { Env } from '../lib/types';

const checkSentEmails = new Hono<{ Bindings: Env }>();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

checkSentEmails.get('/admin-check-sent-emails', async (c) => {
  // Auth
  const token = c.req.query('token') ?? '';
  const tokenResult = await verifyToken(token, c.env.SECRET_KEY);
  if (!tokenResult.valid) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Parse & validate inputs
  const sinceParam = c.req.query('since') ?? '';
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  if (sinceParam && (!sinceDate || isNaN(sinceDate.getTime()))) {
    return c.json({ ok: false, error: 'Invalid `since` — must be ISO 8601 date' }, 400);
  }
  // Default: last 24 hours
  const since = sinceDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  const limitParam = parseInt(c.req.query('limit') ?? '', 10);
  const limit = Math.min(Math.max(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, 1), MAX_LIMIT);

  // Query MS Graph SentItems
  const graph = new MSGraphClient(c.env, c.executionCtx);
  const sinceISO = since.toISOString();
  const path = `/me/mailFolders/SentItems/messages`
    + `?$filter=sentDateTime ge ${sinceISO}`
    + `&$orderby=sentDateTime DESC`
    + `&$select=subject,toRecipients,sentDateTime`
    + `&$top=${limit}`;

  const result = await graph.get(path);
  const messages: Array<{ subject: string; toRecipients: Array<{ emailAddress: { address: string; name?: string } }>; sentDateTime: string }> = result?.value ?? [];

  // Flatten response
  const emails = messages.map((m) => ({
    subject: m.subject,
    recipient: m.toRecipients?.[0]?.emailAddress?.address ?? '(unknown)',
    recipientName: m.toRecipients?.[0]?.emailAddress?.name ?? '',
    sentAt: m.sentDateTime,
  }));

  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, count: emails.length, since: sinceISO, emails });
});

export default checkSentEmails;
