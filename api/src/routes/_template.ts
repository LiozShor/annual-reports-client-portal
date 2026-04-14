/**
 * Route Template — Copy this file to create a new endpoint migration.
 *
 * Steps:
 * 1. Copy to routes/my-endpoint.ts
 * 2. Update the route handlers below
 * 3. Import and mount in src/index.ts:
 *      import myEndpoint from './routes/my-endpoint';
 *      app.route('/webhook', myEndpoint);
 * 4. Deploy: `wrangler deploy`
 * 5. Update shared/endpoints.js in the frontend to point to the Worker URL
 *    (change the specific endpoint, keep others on n8n)
 */

import { Hono } from 'hono';
import type { Env } from '../lib/types';

const route = new Hono<{ Bindings: Env }>();

// Example: GET /webhook/my-endpoint
route.get('/my-endpoint', async (c) => {
  // Access secrets/vars via c.env
  // const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Fire-and-forget background work:
  // c.executionCtx.waitUntil(someAsyncWork());

  return c.json({ ok: true, data: {} });
});

export default route;
