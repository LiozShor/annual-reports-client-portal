/**
 * 3-tier client identification for inbound emails.
 * Migrated from n8n WF05 (cIa23K8v1PrbDJqY).
 *
 * Cascade: email_direct → forwarded_email → sender_name → ai_identification → unidentified
 */

import type { ProcessingContext, EmailMetadata, ClientMatch } from './types';
import { TABLES } from './types';
import type { AirtableRecord } from '../airtable';

// ---------------------------------------------------------------------------
// Airtable field interfaces
// ---------------------------------------------------------------------------

interface ClientFields {
  email?: string;
  cc_email?: string;
  name?: string;
  client_id?: string;
}

interface ReportFields {
  client?: string[];
  stage?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OFFICE_DOMAIN = '@moshe-atsits.co.il';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const AI_MAX_TOKENS = 300;
const AI_MIN_CONFIDENCE = 0.5;
const BODY_PREVIEW_LENGTH = 2000;

const UNIDENTIFIED_RESULT: ClientMatch = {
  clientRecordId: '',
  clientName: 'לקוח לא מזוהה',
  clientId: '',
  email: '',
  matchMethod: 'unidentified',
  confidence: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape single quotes for Airtable filterByFormula */
function escapeAirtable(value: string): string {
  return value.replace(/'/g, "\\'");
}

/** Build a ClientMatch from an Airtable client record */
function matchFromRecord(
  record: AirtableRecord<ClientFields>,
  method: ClientMatch['matchMethod'],
  confidence: number,
  email: string,
): ClientMatch {
  return {
    clientRecordId: record.id,
    clientName: record.fields.name ?? '',
    clientId: record.fields.client_id ?? '',
    email,
    matchMethod: method,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Tier 1 — Direct email match
// ---------------------------------------------------------------------------

async function matchByEmail(
  pCtx: ProcessingContext,
  senderEmail: string,
): Promise<ClientMatch | null> {
  const emailLower = escapeAirtable(senderEmail.toLowerCase());

  // Check primary email
  const primary = await pCtx.airtable.listRecords<ClientFields>(TABLES.CLIENTS, {
    filterByFormula: `LOWER({email}) = '${emailLower}'`,
    fields: ['email', 'cc_email', 'name', 'client_id'],
    maxRecords: 1,
  });

  if (primary.records.length > 0) {
    return matchFromRecord(primary.records[0], 'email_match', 1.0, senderEmail);
  }

  // Check secondary email
  const secondary = await pCtx.airtable.listRecords<ClientFields>(TABLES.CLIENTS, {
    filterByFormula: `LOWER({cc_email}) = '${emailLower}'`,
    fields: ['email', 'cc_email', 'name', 'client_id'],
    maxRecords: 1,
  });

  if (secondary.records.length > 0) {
    return matchFromRecord(secondary.records[0], 'email_match', 1.0, senderEmail);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tier 2 — Forwarded email parsing
// ---------------------------------------------------------------------------

/** Extract original sender email from forwarded email body */
function parseForwardedEmail(bodyText: string): string | null {
  const patterns = [
    // From: Name <email@domain.com>
    /From:\s*[^<]*<([^>]+)>/i,
    // Hebrew: מאת: ... <email>
    /מאת:\s*[^<]*<([^>]+)>/,
    // Hebrew: מ: ... <email>
    /מ:\s*[^<]*<([^>]+)>/,
    // [mailto:email@domain.com]
    /\[mailto:([^\]]+)\]/i,
  ];

  for (const pattern of patterns) {
    const match = bodyText.match(pattern);
    if (match?.[1]) {
      const email = match[1].trim().toLowerCase();
      // Basic validation
      if (email.includes('@') && email.includes('.')) {
        return email;
      }
    }
  }

  return null;
}

/** Check if extracted forwarded email is same as sender (not actually forwarded) */
function isForwardedSelfMatch(extractedEmail: string, senderEmail: string): boolean {
  return extractedEmail.toLowerCase() === senderEmail.toLowerCase();
}

async function matchByForwardedEmail(
  pCtx: ProcessingContext,
  metadata: EmailMetadata,
): Promise<ClientMatch | null> {
  // Only check forwards from office domain
  if (!metadata.senderEmail.toLowerCase().endsWith(OFFICE_DOMAIN)) {
    return null;
  }

  const forwardedEmail = parseForwardedEmail(metadata.bodyText);
  if (!forwardedEmail || isForwardedSelfMatch(forwardedEmail, metadata.senderEmail)) {
    return null;
  }

  const emailLower = escapeAirtable(forwardedEmail);

  const result = await pCtx.airtable.listRecords<ClientFields>(TABLES.CLIENTS, {
    filterByFormula: `OR(LOWER({email}) = '${emailLower}', LOWER({cc_email}) = '${emailLower}')`,
    fields: ['email', 'cc_email', 'name', 'client_id'],
    maxRecords: 1,
  });

  if (result.records.length > 0) {
    return matchFromRecord(result.records[0], 'forwarded_email', 0.9, forwardedEmail);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tier 3 — Sender name match
// ---------------------------------------------------------------------------

async function fetchActiveClients(
  pCtx: ProcessingContext,
): Promise<AirtableRecord<ClientFields>[]> {
  // Get all reports in active stages (not Completed)
  const reports = await pCtx.airtable.listAllRecords<ReportFields>(TABLES.REPORTS, {
    filterByFormula: `{stage} != 'Completed'`,
    fields: ['client'],
  });

  // Collect unique client record IDs
  const clientIds = new Set<string>();
  for (const report of reports) {
    const ids = report.fields.client;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        clientIds.add(id);
      }
    }
  }

  if (clientIds.size === 0) {
    return [];
  }

  // Fetch all clients — filter in-memory since Airtable doesn't support IN()
  const allClients = await pCtx.airtable.listAllRecords<ClientFields>(TABLES.CLIENTS, {
    fields: ['email', 'cc_email', 'name', 'client_id'],
  });

  return allClients.filter((c) => clientIds.has(c.id));
}

async function matchBySenderName(
  pCtx: ProcessingContext,
  metadata: EmailMetadata,
): Promise<{ match: ClientMatch | null; activeClients: AirtableRecord<ClientFields>[] }> {
  // Skip if sender is office — would match office worker, not client
  if (metadata.senderEmail.toLowerCase().endsWith(OFFICE_DOMAIN)) {
    return { match: null, activeClients: [] };
  }

  const activeClients = await fetchActiveClients(pCtx);
  const senderName = metadata.senderName.trim().toLowerCase();

  if (!senderName) {
    return { match: null, activeClients };
  }

  for (const client of activeClients) {
    const clientName = (client.fields.name ?? '').trim().toLowerCase();
    if (clientName && clientName === senderName) {
      return {
        match: matchFromRecord(client, 'sender_name', 0.8, metadata.senderEmail),
        activeClients,
      };
    }
  }

  return { match: null, activeClients };
}

// ---------------------------------------------------------------------------
// Tier 4 — AI identification (Haiku)
// ---------------------------------------------------------------------------

interface AIIdentificationResponse {
  client_id?: string;
  client_name?: string;
  confidence?: number;
  reasoning?: string;
}

async function matchByAI(
  pCtx: ProcessingContext,
  metadata: EmailMetadata,
  activeClients: AirtableRecord<ClientFields>[],
  attachmentNames?: string[],
): Promise<ClientMatch | null> {
  // Build client list for AI context
  const clientList = activeClients
    .map((c) => `${c.fields.client_id ?? ''} - ${c.fields.name ?? ''}`)
    .join('\n');

  const bodyTruncated = metadata.bodyText.slice(0, BODY_PREVIEW_LENGTH);

  const systemPrompt =
    'You are a client identification assistant for a CPA firm. ' +
    'Given an email, identify which client it\'s about. ' +
    'Return JSON: {client_id, client_name, confidence, reasoning}';

  const userPrompt = [
    `Sender: ${metadata.senderName} <${metadata.senderEmail}>`,
    `Subject: ${metadata.subject}`,
    ...(attachmentNames && attachmentNames.length > 0
      ? [`Attachments: ${attachmentNames.join(', ')}`]
      : []),
    `Body:\n${bodyTruncated}`,
    '',
    'Active clients:',
    clientList,
    '',
    'Return a JSON object with client_id, client_name, confidence (0-1), and reasoning.',
    'If you cannot identify the client, return confidence: 0.',
  ].join('\n');

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': pCtx.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: AI_MAX_TOKENS,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let aiResult: AIIdentificationResponse;
  try {
    const data = (await response.json()) as {
      content?: { type: string; text: string }[];
    };
    const text = data.content?.[0]?.text ?? '';
    // Extract JSON from potential markdown code block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    aiResult = JSON.parse(jsonMatch[0]) as AIIdentificationResponse;
  } catch {
    return null;
  }

  const confidence = aiResult.confidence ?? 0;
  if (confidence < AI_MIN_CONFIDENCE) {
    return null;
  }

  // Match AI response against active clients list
  const aiClientId = (aiResult.client_id ?? '').trim().toLowerCase();
  const aiClientName = (aiResult.client_name ?? '').trim().toLowerCase();

  for (const client of activeClients) {
    const cId = (client.fields.client_id ?? '').trim().toLowerCase();
    const cName = (client.fields.name ?? '').trim().toLowerCase();

    if ((aiClientId && cId === aiClientId) || (aiClientName && cName === aiClientName)) {
      return matchFromRecord(client, 'ai_identification', confidence, metadata.senderEmail);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Identify which client an inbound email belongs to.
 * Uses a 4-tier cascade: email → forwarded → name → AI → unidentified.
 */
export async function identifyClient(
  pCtx: ProcessingContext,
  metadata: EmailMetadata,
  attachmentNames?: string[],
): Promise<ClientMatch> {
  // Tier 1: Direct email match
  const emailMatch = await matchByEmail(pCtx, metadata.senderEmail);
  if (emailMatch) return emailMatch;

  // Tier 2: Forwarded email match
  const forwardedMatch = await matchByForwardedEmail(pCtx, metadata);
  if (forwardedMatch) return forwardedMatch;

  // Tier 3: Sender name match (also fetches active clients for Tier 4)
  const { match: nameMatch, activeClients } = await matchBySenderName(pCtx, metadata);
  if (nameMatch) return nameMatch;

  // Tier 4: AI identification
  // If Tier 3 was skipped (office sender), fetch active clients now for AI
  const clients = activeClients.length > 0
    ? activeClients
    : await fetchActiveClients(pCtx);

  if (clients.length > 0) {
    const aiMatch = await matchByAI(pCtx, metadata, clients, attachmentNames);
    if (aiMatch) return aiMatch;
  }

  // Fallback: unidentified
  return { ...UNIDENTIFIED_RESULT, email: metadata.senderEmail };
}
