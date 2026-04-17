import { Hono } from 'hono';
import { corsMiddleware } from './middleware/cors';
import auth from './routes/auth';
import dashboard from './routes/dashboard';
import pending from './routes/pending';
import questionnaires from './routes/questionnaires';
import submission from './routes/submission';
import stage from './routes/stage';
import client from './routes/client';
import importRoute from './routes/import';
import rollover from './routes/rollover';
import reset from './routes/reset';
import preview from './routes/preview';
import documents from './routes/documents';
import classifications from './routes/classifications';
import reminders from './routes/reminders';
import editDocuments from './routes/edit-documents';
import approveAndSend from './routes/approve-and-send';
import sendQuestionnaires from './routes/send-questionnaires';
import adminAssistedLink from './routes/admin-assisted-link';
import chat from './routes/chat';
import feedback from './routes/feedback';
import uploadDocument from './routes/upload-document';
import inboundEmail from './routes/inbound-email';
import clientReports from './routes/client-reports';
import adminPendingApproval from './routes/admin-pending-approval';
import checkSentEmails from './routes/check-sent-emails';
import createFolders from './routes/create-folders';
import checkFolders from './routes/check-folders';
import backfill from './routes/backfill';
import extractIssuerNames from './routes/extract-issuer-names';
import { logError } from './lib/error-logger';
import { handleInboundQueue } from './lib/inbound/queue-consumer';
import { handleInboundDLQ } from './lib/inbound/dlq-consumer';
import type { Env, InboundQueueMessage } from './lib/types';

const app = new Hono<{ Bindings: Env }>();

// CORS — applied to all routes
app.use('*', async (c, next) => {
  const middleware = corsMiddleware(c.env.ALLOWED_ORIGIN);
  return middleware(c, next);
});

// Mount routes under /webhook
app.route('/webhook', auth);
app.route('/webhook', dashboard);
app.route('/webhook', pending);
app.route('/webhook', questionnaires);
app.route('/webhook', submission);
app.route('/webhook', stage);
app.route('/webhook', client);
app.route('/webhook', importRoute);
app.route('/webhook', rollover);
app.route('/webhook', reset);
app.route('/webhook', preview);
app.route('/webhook', documents);
app.route('/webhook', classifications);
app.route('/webhook', reminders);
app.route('/webhook', editDocuments);
app.route('/webhook', approveAndSend);
app.route('/webhook', sendQuestionnaires);
app.route('/webhook', adminAssistedLink);
app.route('/webhook', chat);
app.route('/webhook', feedback);
app.route('/webhook', uploadDocument);
app.route('/webhook', inboundEmail);
app.route('/webhook', clientReports);
app.route('/webhook', adminPendingApproval);
app.route('/webhook', checkSentEmails);
app.route('/webhook', createFolders);
app.route('/webhook', checkFolders);
app.route('/webhook', backfill); // DL-267: temporary — remove after backfill
app.route('/webhook', extractIssuerNames);

// Health check
app.get('/health', (c) => c.json({ ok: true, service: 'annual-reports-api' }));

// 404 fallback
app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err.message);
  logError(c.executionCtx, c.env, {
    endpoint: c.req.path,
    error: err,
    category: 'INTERNAL',
  });
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<InboundQueueMessage>, env: Env, ctx: ExecutionContext) {
    if (batch.queue === 'inbound-email') {
      return handleInboundQueue(batch, env, ctx);
    }
    if (batch.queue === 'inbound-email-dlq') {
      return handleInboundDLQ(batch, env, ctx);
    }
    console.error(`[worker] unknown queue: ${batch.queue}`);
    throw new Error(`Unknown queue: ${batch.queue}`);
  },
};
