/**
 * Phase 5 — /edit-documents endpoint (DL-174)
 *
 * Hybrid: Worker handles all Airtable CRUD + responds.
 * Fires n8n async for office email notification (if send_email flag set).
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { MSGraphClient } from '../lib/ms-graph';
import { logSecurity, getClientIp } from '../lib/security-log';
import { logAudit } from '../lib/audit-log';
import { logError } from '../lib/error-logger';
import { checkAutoAdvanceToReview } from '../lib/auto-advance';
import { isLastReference } from '../lib/file-refcount';
import { DRIVE_ID } from '../lib/classification-helpers';
import { sanitizeBatchUpdates } from '../lib/batch-sanitize.mjs';
import type { Env } from '../lib/types';

const editDocuments = new Hono<{ Bindings: Env }>();

const TABLES = {
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
};

/** Fields to null-out when a doc reverts to Required_Missing (DL-205) */
const FILE_FIELDS_TO_CLEAR = [
  'file_url', 'onedrive_item_id', 'expected_filename', 'file_hash',
  'uploaded_at', 'source_attachment_name', 'source_message_id',
  'source_internet_message_id', 'source_sender_email',
  'ai_confidence', 'ai_reason', 'review_status',
];

/** Fire n8n internal webhook asynchronously */
function fireN8n(
  ctx: ExecutionContext,
  env: Env,
  path: string,
  payload: Record<string, unknown>
): void {
  const url = `https://liozshor.app.n8n.cloud/webhook${path}`;
  ctx.waitUntil(
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': env.N8N_INTERNAL_KEY,
      },
      body: JSON.stringify(payload),
    }).catch(err => {
      console.error(`[n8n-webhook] ${path} failed:`, err.message);
    })
  );
}

/**
 * DL-314: Move a OneDrive file to the year-level ארכיון folder.
 * Mirrors classifications.ts `moveFileToArchive` — kept local here to avoid
 * cross-route import churn.
 */
async function moveFileToArchiveInline(msGraph: MSGraphClient, itemId: string) {
  try {
    const fileInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${itemId}?$select=id,name,parentReference`);
    const filingFolderId = fileInfo?.parentReference?.id;
    if (!filingFolderId) return;
    const filingFolderInfo = await msGraph.get(`/drives/${DRIVE_ID}/items/${filingFolderId}?$select=id,name,parentReference`);
    const yearFolderId = filingFolderInfo?.parentReference?.id || filingFolderId;
    let archiveFolderId: string | null = null;
    try {
      const created = await msGraph.post(`/drives/${DRIVE_ID}/items/${yearFolderId}/children`, {
        name: 'ארכיון',
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      });
      archiveFolderId = created?.id;
    } catch {
      try {
        const existing = await msGraph.get(`/drives/${DRIVE_ID}/items/${yearFolderId}:/${encodeURIComponent('ארכיון')}:`);
        archiveFolderId = existing?.id;
      } catch {
        /* non-fatal */
      }
    }
    if (archiveFolderId) {
      await msGraph.patch(`/drives/${DRIVE_ID}/items/${itemId}`, { parentReference: { id: archiveFolderId } });
    }
  } catch (err) {
    console.error('[edit-documents.moveFileToArchiveInline] Failed:', (err as Error).message);
  }
}

/** Convert markdown bold **text** to HTML <b>text</b> */
function mdBoldToHtml(str: string): string {
  return (str || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

interface ExtractedData {
  report_record_id: string;
  client_name: string;
  spouse_name: string;
  year: string;
  docs_to_waive_ids: string[];
  docs_to_waive_names: string[];
  docs_to_create: {
    issuer_name: string;
    issuer_name_en: string;
    template_id: string;
    category: string;
    person: string;
    issuer_key: string;
  }[];
  notes: string;
  has_changes: boolean;
  docs_to_restore: { id: string; text?: string }[];
  status_changes: { id: string; new_status: string; name?: string }[];
  note_updates: { id: string; note: string }[];
  name_updates: { id: string; issuer_name: string; old_name?: string }[];
  send_email: boolean;
  client_questions?: unknown[];
}

/** Extract & Validate — parse Tally-like JSON body */
function extractAndValidate(body: Record<string, unknown>): ExtractedData {
  const fields = ((body.data as Record<string, unknown>)?.fields as unknown[]) || [];
  let report_record_id = '';
  let client_name = '';
  let spouse_name = '';
  let year = '';
  const docs_to_waive_ids: string[] = [];
  const docs_to_waive_names: string[] = [];
  let docs_to_create: ExtractedData['docs_to_create'] = [];
  let notes = '';

  for (const field of fields) {
    const f = field as Record<string, unknown>;
    const label = String(f.label || '').trim();
    const lowerLabel = label.toLowerCase();
    const value = f.value;
    const type = f.type as string;
    const options = (f.options as { id?: string; text?: string; name?: string }[]) || [];

    if (type === 'HIDDEN_FIELDS') {
      if (typeof value === 'object' && value !== null) {
        const v = value as Record<string, unknown>;
        report_record_id = String(v.report_record_id || '');
        client_name = String(v.client_name || '');
        spouse_name = String(v.spouse_name || '');
        year = String(v.year || '');
      }
      continue;
    }

    // Waive checkboxes
    if (type === 'CHECKBOXES' && (lowerLabel.includes('waive') || label.includes('שינוי סטטוס'))) {
      if (Array.isArray(options) && options.length > 0) {
        for (const opt of options) {
          if (opt.id) docs_to_waive_ids.push(opt.id);
          if (opt.text) docs_to_waive_names.push(opt.text);
        }
      } else if (Array.isArray(value)) {
        for (const opt of value as unknown[]) {
          if (typeof opt === 'object' && opt !== null) {
            const o = opt as Record<string, unknown>;
            if (o.id) docs_to_waive_ids.push(String(o.id));
            if (o.text) docs_to_waive_names.push(String(o.text));
          } else if (typeof opt === 'string') {
            docs_to_waive_ids.push(opt);
          }
        }
      }
      continue;
    }

    // Add checkboxes
    if (type === 'CHECKBOXES' && (lowerLabel.includes('add') || label.includes('הוספה'))) {
      if (Array.isArray(options) && options.length > 0) {
        for (const opt of options) {
          const name = opt.text || opt.name || '';
          if (name) docs_to_create.push({ issuer_name: name.trim(), issuer_name_en: '', template_id: 'general_doc', category: 'other', person: 'client', issuer_key: name.trim() });
        }
      } else if (Array.isArray(value)) {
        for (const opt of value as unknown[]) {
          const name = typeof opt === 'string' ? opt : ((opt as Record<string, unknown>)?.text || (opt as Record<string, unknown>)?.name || '') as string;
          if (name) docs_to_create.push({ issuer_name: name.trim(), issuer_name_en: '', template_id: 'general_doc', category: 'other', person: 'client', issuer_key: name.trim() });
        }
      }
      continue;
    }

    // Custom doc input
    if (type === 'INPUT_TEXT' && (lowerLabel.includes('custom') || label.includes('מותאם אישית'))) {
      const lines = String(value || '').split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        docs_to_create.push({ issuer_name: line, issuer_name_en: '', template_id: 'general_doc', category: 'other', person: 'client', issuer_key: line });
      }
      continue;
    }

    if (type === 'TEXTAREA') {
      notes = String(value || '').trim();
      continue;
    }
  }

  // Fallback: top-level fields
  if (!report_record_id && body.report_record_id) report_record_id = String(body.report_record_id);
  if (!client_name && body.client_name) client_name = String(body.client_name);
  if (!spouse_name && body.spouse_name) spouse_name = String(body.spouse_name);
  if (!year && body.year) year = String(body.year);

  // Extensions
  const extensions = ((body.data as Record<string, unknown>)?.extensions || {}) as Record<string, unknown>;
  const docs_to_restore = Array.isArray(extensions.docs_to_restore) ? extensions.docs_to_restore as { id: string; text?: string }[] : [];
  const status_changes = Array.isArray(extensions.status_changes) ? extensions.status_changes as { id: string; new_status: string; name?: string }[] : [];
  const note_updates = Array.isArray(extensions.note_updates) ? extensions.note_updates as { id: string; note: string }[] : [];
  const name_updates = Array.isArray(extensions.name_updates) ? extensions.name_updates as { id: string; issuer_name: string; old_name?: string }[] : [];
  const send_email = extensions.send_email !== false;
  const client_questions = Array.isArray(extensions.client_questions) ? extensions.client_questions as unknown[] : undefined;

  // Override docs_to_create from extensions if provided (structured format)
  if (Array.isArray(extensions.docs_to_create) && (extensions.docs_to_create as unknown[]).length > 0) {
    docs_to_create = (extensions.docs_to_create as Record<string, unknown>[]).map(d => ({
      issuer_name: String(d.issuer_name || ''),
      issuer_name_en: String(d.issuer_name_en || ''),
      template_id: String(d.template_id || 'general_doc'),
      category: String(d.category || 'other'),
      person: String(d.person || 'client'),
      issuer_key: String(d.issuer_key || ''),
    }));
  }

  const has_changes = docs_to_waive_ids.length > 0 || docs_to_create.length > 0 ||
    docs_to_restore.length > 0 || status_changes.length > 0 ||
    note_updates.length > 0 || name_updates.length > 0;

  return {
    report_record_id, client_name, spouse_name, year,
    docs_to_waive_ids, docs_to_waive_names, docs_to_create,
    notes, has_changes, docs_to_restore, status_changes,
    note_updates, name_updates, send_email, client_questions,
  };
}

/** Build update map from all change types (waive, restore, status, notes, names) */
function buildUpdateMap(data: ExtractedData): Map<string, Record<string, unknown>> {
  const updateMap = new Map<string, Record<string, unknown>>();

  for (const id of data.docs_to_waive_ids) {
    if (!updateMap.has(id)) updateMap.set(id, { id });
    updateMap.get(id)!.status = 'Waived';
  }

  for (const doc of data.docs_to_restore) {
    if (!doc.id) continue;
    if (!updateMap.has(doc.id)) updateMap.set(doc.id, { id: doc.id });
    updateMap.get(doc.id)!.status = 'Required_Missing';
  }

  for (const change of data.status_changes) {
    if (!change.id) continue;
    if (!updateMap.has(change.id)) updateMap.set(change.id, { id: change.id });
    updateMap.get(change.id)!.status = change.new_status;
  }

  for (const note of data.note_updates) {
    if (!note.id) continue;
    if (!updateMap.has(note.id)) updateMap.set(note.id, { id: note.id });
    updateMap.get(note.id)!.bookkeepers_notes = note.note;
  }

  for (const nameUpd of data.name_updates) {
    if (!nameUpd.id) continue;
    if (!updateMap.has(nameUpd.id)) updateMap.set(nameUpd.id, { id: nameUpd.id });
    updateMap.get(nameUpd.id)!.issuer_name = nameUpd.issuer_name;
    // DL-293: promoting / editing issuer_name clears any pending AI suggestion
    updateMap.get(nameUpd.id)!.issuer_name_suggested = '';
  }

  // DL-205: Clear file fields for any doc reverting to Missing
  for (const entry of updateMap.values()) {
    if (entry.status === 'Required_Missing') {
      for (const field of FILE_FIELDS_TO_CLEAR) {
        entry[field] = null;
      }
    }
  }

  return updateMap;
}

/** Build create items with document_uid */
function buildCreateItems(data: ExtractedData): { fields: Record<string, unknown> }[] {
  return data.docs_to_create.map(doc => {
    const templateId = (doc.template_id || 'general_doc').toLowerCase();
    const person = doc.person || 'client';
    const rawKey = doc.issuer_key || '';
    // Normalize issuer_key: spaces→underscores, strip non-alphanumeric/Hebrew
    const issuerKey = rawKey
      .replace(/\s+/g, '_')
      .replace(/[^\u05d0-\u05eaa-zA-Z0-9_]/g, '')
      .toLowerCase();
    // Build UID matching workflow [02] format
    let uid = `${data.report_record_id.toLowerCase()}_${templateId}_${person}`;
    if (issuerKey) uid += `_${issuerKey}`;

    return {
      fields: {
        report: [data.report_record_id],
        document_uid: uid,
        document_key: uid,
        type: doc.template_id || 'general_doc',
        category: doc.category || 'general',
        person,
        issuer_name: mdBoldToHtml(doc.issuer_name),
        issuer_name_en: mdBoldToHtml(doc.issuer_name_en),
        issuer_key: rawKey,
        status: 'Required_Missing',
      },
    };
  });
}

// POST /webhook/edit-documents
editDocuments.post('/edit-documents', async (c) => {
  const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
  const clientIp = getClientIp(c.req.raw.headers);

  try {
    // Auth — Bearer token in Authorization header
    const authHeader = c.req.header('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    const tokenResult = await verifyToken(bearerToken, c.env.SECRET_KEY);
    if (!tokenResult.valid) {
      logSecurity(c.executionCtx, airtable, {
        timestamp: new Date().toISOString(),
        event_type: tokenResult.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
        severity: 'WARNING',
        actor: 'admin-token',
        actor_ip: clientIp,
        endpoint: '/webhook/edit-documents',
        http_status: 401,
        error_message: tokenResult.reason || '',
      });
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await c.req.json() as Record<string, unknown>;
    const data = extractAndValidate(body);

    if (!data.report_record_id) {
      return c.json({ ok: false, error: 'Missing report_record_id' }, 400);
    }

    // Save client_questions to report (fire-and-forget)
    if (data.client_questions && data.client_questions.length > 0) {
      c.executionCtx.waitUntil(
        airtable.updateRecord(TABLES.REPORTS, data.report_record_id, {
          client_questions: JSON.stringify(data.client_questions),
        }).catch(() => { /* non-blocking */ })
      );
    }

    if (!data.has_changes) {
      return c.json({ ok: true, changes: 0 });
    }

    // ---- Batch update existing docs (waive, restore, status, notes, names) ----
    const updateMap = buildUpdateMap(data);
    const updates = Array.from(updateMap.values());

    // DL-314: identify docs losing their file reference — if this was the LAST
    // ref for a shared OneDrive item, archive the physical file after the update.
    const archiveCandidates: Array<{ docId: string; onedriveItemId: string }> = [];
    for (const entry of updates) {
      if (entry.status === 'Required_Missing' || entry.status === 'Waived') {
        try {
          const rec = await airtable.getRecord(TABLES.DOCUMENTS, entry.id as string);
          const itemId = (rec.fields as Record<string, unknown>).onedrive_item_id as string;
          if (itemId) archiveCandidates.push({ docId: entry.id as string, onedriveItemId: itemId });
        } catch {
          // non-fatal — record may not exist
        }
      }
    }

    if (updates.length > 0) {
      const airtableUpdates = updates.map(u => ({
        id: u.id as string,
        fields: Object.fromEntries(
          Object.entries(u).filter(([k]) => k !== 'id')
        ),
      }));

      // DL-331: drop malformed records (bad id shape / empty fields) so one
      // bad entry doesn't 422 the entire 10-record Airtable batch.
      const { valid, dropped } = sanitizeBatchUpdates(airtableUpdates);
      if (dropped.length > 0) {
        console.warn('[edit-documents] dropped malformed updates:', JSON.stringify(dropped));
        logError(c.executionCtx, c.env, {
          endpoint: '/webhook/edit-documents',
          error: new Error(`Dropped ${dropped.length} malformed batchUpdate records`),
          category: 'VALIDATION',
          details: JSON.stringify({ report_record_id: data.report_record_id, dropped }),
        });
      }

      for (let i = 0; i < valid.length; i += 10) {
        await airtable.batchUpdate(TABLES.DOCUMENTS, valid.slice(i, i + 10));
      }
    }

    // ---- Batch create new docs ----
    const createItems = buildCreateItems(data);
    if (createItems.length > 0) {
      // Use upsert with document_uid to prevent duplicates
      await airtable.upsertRecords(TABLES.DOCUMENTS, createItems, ['document_uid']);
    }

    // ---- DL-314: archive OneDrive file when LAST reference is released ----
    if (archiveCandidates.length > 0) {
      c.executionCtx.waitUntil((async () => {
        const msGraph = new MSGraphClient(c.env, c.executionCtx);
        for (const cand of archiveCandidates) {
          try {
            if (await isLastReference(airtable, cand.onedriveItemId, cand.docId)) {
              await moveFileToArchiveInline(msGraph, cand.onedriveItemId);
            } else {
              console.log('[edit-documents] skip archive — file still referenced', cand.onedriveItemId);
            }
          } catch (err) {
            console.error('[edit-documents] archive failed for', cand.onedriveItemId, (err as Error).message);
          }
        }
      })());
    }

    // ---- Check completion & advance stage (DL-267) ----
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await airtable.updateRecord(TABLES.REPORTS, data.report_record_id, {
            last_progress_check_at: new Date().toISOString(),
          });
          await checkAutoAdvanceToReview(airtable, data.report_record_id);
        } catch (err) {
          console.error('[edit-documents] completion check failed:', (err as Error).message);
        }
      })()
    );

    // ---- Fire n8n for office email notification (if send_email) ----
    if (data.send_email) {
      // Fire existing n8n webhook — auth bypassed via X-Internal-Key header.
      // n8n will re-do CRUD (idempotent) + build email + send to office.
      fireN8n(c.executionCtx, c.env, '/edit-documents', {
        data: body.data, // Pass original Tally-like body so Extract & Validate works
      });
    }

    logAudit(c.executionCtx, airtable, {
      action: 'edit_documents',
      report_id: data.report_record_id,
      details: `Updated ${updates.length} docs, created ${createItems.length} docs`,
    });

    return c.json({ ok: true });

  } catch (err) {
    console.error('[edit-documents] Error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/edit-documents',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default editDocuments;
