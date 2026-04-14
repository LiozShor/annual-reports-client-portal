import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { resolveOneDriveRoot, createClientFolderStructure } from '../lib/inbound/attachment-utils';
import { generateHexToken } from '../lib/crypto';
import type { Env } from '../lib/types';

const importRoute = new Hono<{ Bindings: Env }>();

// POST /webhook/admin-bulk-import
importRoute.post('/admin-bulk-import', async (c) => {
  const body = await c.req.json<{
    token?: string; year?: number; filing_type?: string; clients?: { name: string; email: string; cc_email?: string }[];
  }>();
  const tokenResult = await verifyToken(body.token || '', c.env.SECRET_KEY);
  if (!tokenResult.valid) return c.json({ ok: false, error: 'unauthorized' });

  const year = body.year || new Date().getFullYear();
  const filing_type = body.filing_type || 'annual_report';
  const clients = body.clients || [];
  if (clients.length === 0) {
    return c.json({ ok: false, error: 'No clients provided' });
  }

  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);

  // Parallel: get existing clients + reports
  const [existingClients, existingReports] = await Promise.all([
    airtable.listAllRecords('tblFFttFScDRZ7Ah5'),
    airtable.listAllRecords('tbls7m3hmHC4hhQVy', {
      filterByFormula: `{year}=${year}`,
    }),
  ]);

  // Build lookup maps
  const emailToClientId: Record<string, string> = {};
  for (const c of existingClients) {
    const email = ((c.fields.email as string) || '').toLowerCase();
    if (email) emailToClientId[email] = c.id;
  }

  // Composite key: email+filing_type — only block if same type already exists
  const existingCompositeKeys = new Set<string>();
  for (const r of existingReports) {
    const cid = Array.isArray(r.fields.client)
      ? (r.fields.client as string[])[0] : r.fields.client as string;
    const cRec = existingClients.find((c) => c.id === cid);
    const email = cRec ? ((cRec.fields.email as string) || '').toLowerCase() : '';
    const rType = (r.fields.filing_type as string) || 'annual_report';
    if (email) existingCompositeKeys.add(`${email}::${rType}`);
  }

  // Split into new clients vs existing clients needing a new report type
  const newClients: { name: string; email: string; cc_email?: string; report_uid: string }[] = [];
  const existingClientNewType: { name: string; email: string; cc_email?: string; report_uid: string; clientId: string }[] = [];
  let skipped = 0;
  const seenCompositeKeys = new Set<string>();

  for (const client of clients) {
    const email = (client.email || '').toLowerCase().trim();
    const name = (client.name || '').trim();
    if (!email || !name) { skipped++; continue; }

    const compositeKey = `${email}::${filing_type}`;

    // Skip if same email+type already exists (in DB or in this batch)
    if (existingCompositeKeys.has(compositeKey) || seenCompositeKeys.has(compositeKey)) {
      skipped++;
      continue;
    }
    seenCompositeKeys.add(compositeKey);

    if (emailToClientId[email]) {
      // Client exists but with different filing type — reuse client record
      existingClientNewType.push({
        name, email, cc_email: client.cc_email?.trim() || undefined,
        report_uid: crypto.randomUUID(), clientId: emailToClientId[email],
      });
    } else {
      // Brand new client
      newClients.push({ name, email, cc_email: client.cc_email?.trim() || undefined, report_uid: crypto.randomUUID() });
      emailToClientId[email] = '__pending__'; // prevent duplicate client creation in batch
    }
  }

  if (newClients.length === 0 && existingClientNewType.length === 0) {
    return c.json({ ok: true, created: 0, skipped, failed: 0 });
  }

  // Batch create NEW clients only
  let clientErrors: unknown[] = [];
  if (newClients.length > 0) {
    const clientRecords = newClients.map((c) => {
      const fields: Record<string, unknown> = { name: c.name, email: c.email, is_active: true };
      if (c.cc_email) fields.cc_email = c.cc_email;
      return { fields };
    });
    const clientResult = await airtable.batchCreate('tblFFttFScDRZ7Ah5', clientRecords);
    clientErrors = clientResult.errors;

    // Map created clients to their Airtable IDs
    for (const rec of clientResult.created) {
      const email = ((rec.fields.email as string) || '').toLowerCase();
      emailToClientId[email] = rec.id;
    }
  }

  // Batch create reports for ALL (new clients + existing clients with new type)
  const allToCreate = [
    ...newClients.map((c) => ({ email: c.email, report_uid: c.report_uid })),
    ...existingClientNewType.map((c) => ({ email: c.email, report_uid: c.report_uid, clientId: c.clientId })),
  ];

  const reportRecords = allToCreate
    .filter((c) => {
      const cid = ('clientId' in c && c.clientId) ? c.clientId : emailToClientId[c.email.toLowerCase()];
      return cid && cid !== '__pending__';
    })
    .map((c) => ({
      fields: {
        client: [('clientId' in c && c.clientId) ? c.clientId : emailToClientId[c.email.toLowerCase()]],
        year,
        filing_type,
        stage: 'Send_Questionnaire',
        report_uid: c.report_uid,
        questionnaire_token: generateHexToken(32),
        last_progress_check_at: new Date().toISOString(),
      },
    }));

  const reportResult = await airtable.batchCreate('tbls7m3hmHC4hhQVy', reportRecords);

  // Create OneDrive folder structure for each imported client (non-blocking)
  const folderResults: { client: string; ok: boolean; error?: string }[] = [];
  try {
    const graph = new MSGraphClient(c.env, c.executionCtx);
    const root = await resolveOneDriveRoot(graph);
    const allClientNames = [
      ...newClients.map((cl) => cl.name),
      ...existingClientNewType.map((cl) => cl.name),
    ];
    for (const name of allClientNames) {
      try {
        await createClientFolderStructure(graph, root, name, String(year), filing_type);
        folderResults.push({ client: name, ok: true });
      } catch (err: any) {
        folderResults.push({ client: name, ok: false, error: err.message });
      }
    }
  } catch (err: any) {
    folderResults.push({ client: '_root_', ok: false, error: `OneDrive init failed: ${err.message}` });
  }

  return c.json({
    ok: true,
    created: reportResult.created.length,
    skipped,
    failed: clientErrors.length + reportResult.errors.length,
    report_ids: reportResult.created.map((r) => r.id),
    folder_results: folderResults,
    errors: [...clientErrors, ...reportResult.errors].length > 0
      ? [...clientErrors, ...reportResult.errors] : undefined,
  });
});

export default importRoute;
