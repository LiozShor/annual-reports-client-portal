import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { MSGraphClient } from '../lib/ms-graph';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const feedback = new Hono<{ Bindings: Env }>();

const SENDER = 'reports@moshe-atsits.co.il';
const RECIPIENT = 'liozshor1@gmail.com';

feedback.post('/admin-send-feedback', async (c) => {
  try {
    const body = await c.req.json();

    const tokenResult = await verifyToken(body.token, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const { subject, message } = body as { subject: string; message: string };
    if (!subject || !message) {
      return c.json({ ok: false, error: 'subject and message are required' }, 400);
    }

    const timestamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });

    const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; direction: rtl; text-align: right;">
  <div style="text-align: center; padding: 16px 0 8px;">
    <img src="https://docs.moshe-atsits.com/assets/images/logo.png" alt="Moshe Atsits" width="160" style="display:inline-block;border:0;max-width:160px;height:auto;" />
  </div>
  <h2 style="color: #1e40af;">${subject}</h2>
  <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="white-space: pre-wrap; margin: 0;">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
  </div>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
  <p style="color: #6b7280; font-size: 13px;">
    נשלח מהעוזר החכם בפאנל הניהול<br />
    ${timestamp}
  </p>
</body>
</html>`;

    const graph = new MSGraphClient(c.env, c.executionCtx);
    await graph.sendMail(`[משוב מהפאנל] ${subject}`, htmlContent, RECIPIENT, SENDER);

    return c.json({ ok: true });
  } catch (err) {
    console.error('[feedback] Error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/feedback',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default feedback;
