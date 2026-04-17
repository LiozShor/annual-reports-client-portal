/**
 * POST /webhook/extract-issuer-names  (DL-293)
 *
 * Called by WF02 after `Upsert Documents` succeeds. Given the batch of docs
 * for one report and the raw free-text context each doc's issuer_name was
 * generated from, asks Haiku 4.5 to extract the salient organisation name
 * (employer, broker, bank, insurer, …) for each doc.
 *
 * Writes:
 *   - `issuer_name_suggested` on each doc where confidence >= 0.5
 *   - appends `[תשובה מהשאלון] <raw>` to `bookkeepers_notes` (if not already present)
 *
 * NEVER mutates `issuer_name` — admin's 1-click accept on the Review & Approve
 * card (DL-292) does that via the existing EDIT_DOCUMENTS endpoint.
 */

import { Hono } from 'hono';
import { verifyToken } from '../lib/token';
import { AirtableClient } from '../lib/airtable';
import { logError } from '../lib/error-logger';
import type { Env } from '../lib/types';

const route = new Hono<{ Bindings: Env }>();

const DOCUMENTS_TABLE = 'tblcwptR63skeODPn';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const CONFIDENCE_FLOOR = 0.5;
const MAX_RETRIES = 2;
const NOTE_PREFIX = '[תשובה מהשאלון]';

interface DocInput {
  doc_record_id: string;
  template_id: string;
  raw_context: string;
  person?: string;
  existing_notes?: string;
  current_issuer_name?: string;
}

/**
 * Strip HTML tags + collapse whitespace — used only to compare whether the
 * suggestion is literally identical to the existing issuer_name (a no-op).
 * Any real change (e.g. "בלאומי" → "לאומי") is a useful cleanup and should
 * still surface as a suggestion.
 */
function stripForCompare(s: string): string {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the suggestion is literally the same text as the current issuer_name. */
function isNoOpSuggestion(current: string | undefined, suggestion: string): boolean {
  const a = stripForCompare(current || '');
  const b = stripForCompare(suggestion);
  if (!a || !b) return false;
  return a === b;
}

interface ExtractionResult {
  doc_record_id: string;
  issuer_name: string | null;
  confidence: number;
}

const TOOL_SCHEMA = {
  name: 'extract_issuer_names',
  description:
    'Return the extracted organisation name for each doc. Use issuer_name: null when no organisation is identifiable.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            doc_record_id: { type: 'string' },
            issuer_name: { type: ['string', 'null'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['doc_record_id', 'issuer_name', 'confidence'],
        },
      },
    },
    required: ['results'],
  },
} as const;

const SYSTEM_PROMPT = `You extract the single most salient ORGANISATION name (employer, broker, bank, insurance company, pension fund, tax authority, or similar entity) from a Hebrew free-text context describing the client's relationship with that entity.

For each doc below, return {doc_record_id, issuer_name, confidence}.

Rules:
- Return ONLY the organisation name, stripped of prefixes like "חברת", "בבנק", "אצל", "בחברת", "שנקרא", "של", and possessive suffixes. Example: "בחברת אינטראקטיב" → "אינטראקטיב".
- Do NOT return: job titles, cities ("בתל אביב"), generic nouns ("בר", "חברה", "בנק"), date ranges, or amounts.
- If no organisation is identifiable, return issuer_name: null.
- Confidence >= 0.8 only if the entity is explicitly named in the context.
- For banks/insurers, prefer the common short form (e.g. "בנק לאומי", "מגדל", "הפניקס").

Template hints (the expected entity type for each template_id):
- T106/T806: employer (מעסיק)
- T867: broker / investment company (חברת השקעות)
- T601: bank (בנק)
- T501: insurance / pension (חברת ביטוח / קרן פנסיה)
- T901/T902: landlord or tenant (משכיר/שוכר)
- Others: treat as generic organisation`;

function buildUserMessage(docs: DocInput[]): string {
  const lines = docs.map(
    (d) =>
      `- doc_record_id: ${d.doc_record_id}\n  template: ${d.template_id}\n  context: ${d.raw_context}`,
  );
  return `Extract issuer names for each of the following docs:\n\n${lines.join('\n\n')}`;
}

async function callClaude(
  apiKey: string,
  docs: DocInput[],
): Promise<ExtractionResult[]> {
  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(docs) }],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'extract_issuer_names' },
  };

  let resp: Response | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (resp.status !== 429 || attempt === MAX_RETRIES) break;
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }

  if (!resp || !resp.ok) {
    const status = resp?.status ?? 0;
    const text = resp ? await resp.text().catch(() => '') : '';
    throw new Error(`Anthropic API error ${status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; input?: { results?: ExtractionResult[] } }>;
  };

  const toolBlock = data.content.find((b) => b.type === 'tool_use');
  const results = toolBlock?.input?.results;
  if (!Array.isArray(results)) return [];

  return results;
}

function buildNotesUpdate(existing: string | undefined, rawContext: string): string | null {
  const raw = (rawContext || '').trim();
  if (!raw) return null;
  const noteLine = `${NOTE_PREFIX} ${raw}`;
  const prev = (existing || '').trim();
  if (prev.includes(noteLine)) return null;
  return prev ? `${prev}\n\n${noteLine}` : noteLine;
}

route.post('/extract-issuer-names', async (c) => {
  try {
    const authHeader = c.req.header('Authorization') || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : c.req.query('token') || '';

    // Accept either an admin/client HMAC token OR the shared N8N_INTERNAL_KEY
    // used by Worker↔n8n calls (DL-293: WF02 calls this endpoint).
    let authorized = token === c.env.N8N_INTERNAL_KEY && token.length > 0;
    if (!authorized) {
      const auth = await verifyToken(token, c.env.SECRET_KEY);
      authorized = auth.valid;
    }
    if (!authorized) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = (await c.req.json().catch(() => null)) as {
      report_record_id?: string;
      docs?: DocInput[];
    } | null;

    if (!body || !Array.isArray(body.docs)) {
      return c.json({ ok: false, error: 'invalid body' }, 400);
    }

    const docs = body.docs.filter(
      (d) =>
        d &&
        typeof d.doc_record_id === 'string' &&
        typeof d.template_id === 'string' &&
        typeof d.raw_context === 'string' &&
        d.raw_context.trim().length > 0,
    );

    if (docs.length === 0) {
      return c.json({ ok: true, suggested: 0, skipped: 0, results: [] });
    }

    // ---- Call Claude ----
    const results = await callClaude(c.env.ANTHROPIC_API_KEY, docs);
    const byId = new Map(results.map((r) => [r.doc_record_id, r]));

    // ---- Build batch PATCH ----
    const updates: { id: string; fields: Record<string, unknown> }[] = [];
    let suggested = 0;
    let skipped = 0;

    for (const doc of docs) {
      const r = byId.get(doc.doc_record_id);
      const suggestion =
        r && typeof r.issuer_name === 'string' && r.issuer_name.trim().length > 0
          ? r.issuer_name.trim()
          : null;
      const confident = !!r && suggestion !== null && r.confidence >= CONFIDENCE_FLOOR;

      const fields: Record<string, unknown> = {};
      // Skip suggestion when it adds no new info over the existing issuer_name
      // (e.g. existing "בלאומי" + suggestion "לאומי" → no-op).
      const isNoOp = confident && isNoOpSuggestion(doc.current_issuer_name, suggestion!);
      if (confident && !isNoOp) {
        fields.issuer_name_suggested = suggestion;
        suggested++;
      } else {
        skipped++;
      }

      const noteUpdate = buildNotesUpdate(doc.existing_notes, doc.raw_context);
      if (noteUpdate !== null) {
        fields.bookkeepers_notes = noteUpdate;
      }

      if (Object.keys(fields).length > 0) {
        updates.push({ id: doc.doc_record_id, fields });
      }
    }

    if (updates.length > 0) {
      const airtable = new AirtableClient(c.env.AIRTABLE_BASE_ID, c.env.AIRTABLE_PAT);
      await airtable.batchUpdate(DOCUMENTS_TABLE, updates);
    }

    console.log(
      `[extract-issuer-names] report=${body.report_record_id} docs=${docs.length} suggested=${suggested} skipped=${skipped}`,
    );

    return c.json({
      ok: true,
      suggested,
      skipped,
      results: results.map((r) => ({
        doc_record_id: r.doc_record_id,
        issuer_name: r.issuer_name,
        confidence: r.confidence,
      })),
    });
  } catch (err) {
    console.error('[extract-issuer-names] error:', (err as Error).message);
    logError(c.executionCtx, c.env, {
      endpoint: '/webhook/extract-issuer-names',
      error: err as Error,
    });
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});

export default route;
