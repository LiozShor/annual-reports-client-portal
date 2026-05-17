/**
 * Main pipeline orchestrator for inbound email processing.
 * Migrated from n8n WF05 (56 nodes → this single module). DL-203.
 *
 * Called from ctx.waitUntil() after the route handler responds 200.
 */

import type { Env } from '../types';
import { MSGraphClient } from '../ms-graph';
import { AirtableClient, type AirtableRecord } from '../airtable';
import { logError } from '../error-logger';
import { logSecurity } from '../security-log';
import { logEvent } from '../activity-logger';
import {
  type ProcessingContext,
  type EmailMetadata,
  type ActiveReport,
  type AttachmentInfo,
  type ClassificationResult,
  type ClientMatch,
  TABLES,
  MAILBOX,
  OFFICE_CONVERTIBLE,
  IMAGE_EXTENSIONS,
} from './types';
import { fetchAttachments, uploadToOneDrive, resolveOneDriveRoot, getFileExtension, parseDriveLinks, fetchDriveAttachment, stripDriveChipsFromHtml, type OneDriveRoot } from './attachment-utils';
import { identifyClient } from './client-identifier';
import { classifyAttachment, checkFileHashDuplicate, MAX_CLASSIFIABLE_BYTES, TEMPLATE_TITLES } from './document-classifier';

// DL-419: Hebrew sentinel placed in `pending_classifications.matched_doc_name`
// when an attachment is too large for AI classification (>MAX_CLASSIFIABLE_BYTES).
// The row still gets created with a working file_url + onedrive_item_id so the
// office sees it in the AI Review tab and can reassign it via the normal flow.
// Translation: "Large file — needs manual classification".
const OVERSIZE_SENTINEL_DOC_NAME = 'קובץ גדול — דרוש סיווג ידני';
import { resolveOneDriveFilename } from '../classification-helpers';
import { buildTemplateMap } from '../doc-builder';
import { getCachedOrFetch } from '../cache';
import { getPdfPageCount } from '../pdf-split';
import { imageToPdf } from './image-to-pdf';
import { expandArchiveAttachments } from './archive-expander';
import { detectBounce } from './bounce-detector';
import { handleHardBounce } from './bounce-handler';

// ---------------------------------------------------------------------------
// Airtable field interfaces
// ---------------------------------------------------------------------------

interface ReportFields {
  report_key?: string;
  year?: number;
  stage?: string;
  client_name?: string;
  client_id?: string;
  client?: string[];
  notes?: string;
  client_notes?: string;
  client_email?: string | string[];
  filing_type?: string;
}

interface DocFields {
  type: string;
  issuer_name?: string;
  issuer_key?: string;
  person?: string;
  status?: string;
  report_key_lookup?: string;
  expected_filename?: string;
  category?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Auto-reply detection
// ---------------------------------------------------------------------------

const AUTO_REPLY_HEADERS = [
  'x-auto-response-suppress',
  'x-autoreply',
  'auto-submitted',
];

const SYSTEM_SENDER = 'reports@moshe-atsits.co.il';

const AUTO_REPLY_SUBJECT_PATTERNS = [
  /^(re:\s*)?out of office/i,
  /^(re:\s*)?automatic reply/i,
  /^(re:\s*)?auto[- ]?reply/i,
  /undeliverable/i,
  /delivery[.\s]status/i,
  /הודעה אוטומטית/,
  /מענה אוטומטי/,
  /תשובה אוטומטית/,
  /אני לא במשרד/,
  /לא נמצא במשרד/,
];

// ---------------------------------------------------------------------------
// Email extraction
// ---------------------------------------------------------------------------

function extractMetadata(email: Record<string, any>, messageId: string): EmailMetadata {
  const subject = email.subject ?? '';
  const sender = email.from?.emailAddress ?? {};
  const bodyHtmlRaw = email.body?.content ?? '';
  // DL-367: strip Gmail Drive chip blocks before HTML→text conversion so
  // chip filenames (which are attachment metadata, not prose) don't pollute
  // the LLM-summarized note.
  const bodyHtml = stripDriveChipsFromHtml(bodyHtmlRaw);
  const bodyText = bodyHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .trim()
    .slice(0, 2000);

  // Detect auto-reply
  const headers = email.internetMessageHeaders ?? [];
  const isAutoReply =
    headers.some((h: { name: string }) =>
      AUTO_REPLY_HEADERS.includes(h.name.toLowerCase())
    ) || AUTO_REPLY_SUBJECT_PATTERNS.some((p) => p.test(subject));

  const bounceInfo = detectBounce(subject, (sender.address ?? '').toLowerCase(), bodyText);

  return {
    messageId,
    internetMessageId: email.internetMessageId ?? '',
    conversationId: email.conversationId ?? '',
    subject,
    senderEmail: (sender.address ?? '').toLowerCase(),
    senderName: sender.name ?? '',
    receivedAt: email.receivedDateTime ?? new Date().toISOString(),
    bodyPreview: (email.bodyPreview ?? '').slice(0, 500),
    bodyText,
    bodyHtml,
    hasAttachments: email.hasAttachments ?? false,
    isAutoReply,
    bounceInfo,
  };
}

// ---------------------------------------------------------------------------
// Email event management
// ---------------------------------------------------------------------------

async function upsertEmailEvent(
  airtable: AirtableClient,
  metadata: EmailMetadata,
  messageId: string,
  status: string,
  attachments: AttachmentInfo[],
  extra?: Record<string, unknown>,
): Promise<string> {
  const internetMsgIdClean = (metadata.internetMessageId || '').replace(/[<>]/g, '').substring(0, 40);
  const fields: Record<string, unknown> = {
    event_key: `evt_${internetMsgIdClean}_${Date.now()}`,
    source_message_id: messageId,
    source_internet_message_id: metadata.internetMessageId,
    sender_email: metadata.senderEmail,
    subject: metadata.subject,
    processing_status: status,
    received_at: metadata.receivedAt,
    attachment_name: attachments.map(a => a.name).join(', '),
    workflow_run_id: `worker-${Date.now()}`,
    ...extra,
  };

  const results = await airtable.upsertRecords(
    TABLES.EMAIL_EVENTS,
    [{ fields }],
    ['source_message_id'],
  );
  return results[0]?.id ?? '';
}

// ---------------------------------------------------------------------------
// Active report lookup
// ---------------------------------------------------------------------------

async function getActiveReports(
  airtable: AirtableClient,
  clientId: string,
): Promise<ActiveReport[]> {
  const reports = await airtable.listAllRecords<ReportFields>(TABLES.REPORTS, {
    filterByFormula: `AND({client_id} = '${clientId.replace(/'/g, "\\'")}', OR({stage} = 'Collecting_Docs', {stage} = 'Review'))`,
    fields: ['report_key', 'year', 'stage', 'client_name', 'client', 'notes', 'client_notes', 'filing_type'],
  });

  return reports.map(r => ({
    reportRecordId: r.id,
    reportKey: r.fields.report_key ?? '',
    year: r.fields.year ?? new Date().getFullYear(),
    stage: r.fields.stage ?? '',
    clientName: r.fields.client_name ?? '',
    filingType: r.fields.filing_type ?? 'annual_report',
  }));
}

/** Get ALL reports for a client regardless of stage (for note capture + raw uploads) */
async function getAllReports(
  airtable: AirtableClient,
  clientId: string,
): Promise<ActiveReport[]> {
  const reports = await airtable.listAllRecords<ReportFields>(TABLES.REPORTS, {
    filterByFormula: `{client_id} = '${clientId.replace(/'/g, "\\'")}'`,
    fields: ['report_key', 'year', 'stage', 'client_name', 'client', 'notes', 'client_notes', 'filing_type'],
  });

  return reports.map(r => ({
    reportRecordId: r.id,
    reportKey: r.fields.report_key ?? '',
    year: r.fields.year ?? new Date().getFullYear(),
    stage: r.fields.stage ?? '',
    clientName: r.fields.client_name ?? '',
    filingType: r.fields.filing_type ?? 'annual_report',
  }));
}

// ---------------------------------------------------------------------------
// LLM email summarization + client note
// ---------------------------------------------------------------------------

function truncateSummary(text: string, max = 200): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > max * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

/**
 * Strip quoted reply chains, forwarding headers, and email signatures
 * from email body text before sending to LLM.
 */
function stripQuotedContent(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop at Gmail-style quote header (English)
    if (/^On .+ wrote:\s*$/.test(trimmed)) break;
    // Stop at Gmail-style quote header (Hebrew: "ב-DATE כתב:" or "בתאריך... מאת...")
    if (/^ב[-־].+כתב.*:\s*$/.test(trimmed)) break;
    if (/^בתאריך .+מאת .+:\s*$/.test(trimmed)) break;
    // Stop at Outlook "Original Message" (English)
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(trimmed)) break;
    // Stop at Outlook "Original Message" (Hebrew)
    if (/^-{3,}\s*הודעה מקורית\s*-{3,}/.test(trimmed)) break;
    // Stop at Gmail-style "Forwarded message" separator (DL-282)
    if (/^-+\s*Forwarded message\s*-+\s*$/i.test(trimmed)) break;
    // Stop at Outlook HR separator that precedes forward header blocks (DL-282)
    if (/^_{5,}\s*$/.test(trimmed)) break;
    // Stop at forward-header lines — no first-line guard: Outlook forwards
    // without commentary START with this block and must still be stripped (DL-282)
    if (/^(From|מאת|נשלח):\s+.+@/.test(trimmed)) break;
    // Stop at standard sig delimiter
    if (trimmed === '--' || trimmed === '-- ') break;
    // Stop at Hebrew closing lines (signature boundary)
    if (/^(בברכה|תודה|בהוקרה|שלך|בכבוד רב),?\s*$/.test(trimmed)) break;

    // Skip > quoted lines
    if (/^>\s/.test(trimmed)) continue;

    result.push(line);
  }

  return result.join('\n').trim();
}

/**
 * Resolve the `sender_email` value for a client note.
 *
 * Priority (DL-282):
 *   1. Reports.client_email lookup (already fetched by caller).
 *   2. If match was direct-email or forwarded-email, clientMatch.email is the
 *      real client's address — use it.
 *   3. Otherwise (AI or sender-name match), fetch the matched Client record's
 *      email. Never fall back to the envelope sender, which for forwards is
 *      the office forwarder (moshe@ / natan@).
 */
async function resolveNoteSenderEmail(
  airtable: AirtableClient,
  reportClientEmail: string,
  clientMatch: ClientMatch,
): Promise<string> {
  if (reportClientEmail) return reportClientEmail;
  if (clientMatch.matchMethod === 'email_match' || clientMatch.matchMethod === 'forwarded_email') {
    return clientMatch.email;
  }
  if (clientMatch.clientRecordId) {
    try {
      const client = await airtable.getRecord<{ email?: string }>(TABLES.CLIENTS, clientMatch.clientRecordId);
      const email = (client.fields.email ?? '').toLowerCase();
      if (email) return email;
    } catch {
      // Fall through — better to return empty than the forwarder's address
    }
  }
  return '';
}

async function summarizeAndSaveNote(
  pCtx: ProcessingContext,
  metadata: EmailMetadata,
  report: ActiveReport,
  existingClientNotes: string,
  clientEmail: string,
  clientId: string,
): Promise<void> {
  const msgId = metadata.internetMessageId || '';
  const logSkip = (reason: 'dedup' | 'body_too_short' | 'llm_skip') => {
    logSecurity(pCtx.ctx, pCtx.env, pCtx.airtable, {
      timestamp: new Date().toISOString(),
      event_type: 'INBOUND_NOTE_SKIPPED',
      severity: 'INFO',
      actor: 'worker',
      actor_ip: 'internal',
      endpoint: '/inbound/note-save',
      http_status: 200,
      details: JSON.stringify({ reason, message_id: msgId, report_id: report.reportRecordId, client_id: clientId }),
    });
  };

  try {
    const subject = (metadata.subject || '').trim();

    // Parse existing notes (JSON array format)
    let notes: Array<Record<string, unknown>> = [];
    try {
      notes = JSON.parse(existingClientNotes || '[]');
      if (!Array.isArray(notes)) notes = [];
    } catch { notes = []; }

    // Dedup by internet_message_id
    if (msgId && notes.some((n: any) => n.message_id === msgId)) {
      logSkip('dedup');
      return;
    }

    // Pre-strip quoted content and signatures before LLM
    const rawBody = metadata.bodyText || metadata.bodyPreview || '';
    const cleanBody = stripQuotedContent(rawBody);
    if (cleanBody.length < 10 && subject.length < 5) {
      logSkip('body_too_short');
      return;
    }

    // Hard override: never skip emails carrying credentials. PDF passwords
    // arrive as short messages ("סיסמה: I4NB36") that Haiku tends to
    // classify as attachment-only — losing the password is unacceptable.
    const hasCredential =
      /סיסמ[האא]\s*[:：]?/i.test(cleanBody) ||
      /\bpassword\s*[:：]/i.test(cleanBody) ||
      /\bpwd\s*[:：]/i.test(cleanBody) ||
      /\bקוד\b/.test(cleanBody);

    // Hard override: never skip emails containing a question, doubt, or dispute.
    // Sivan 2026-05-17 incident: "הי זכור לי שמיליתי, אני טועה?" was llm_skip'd
    // even though it's an actual question the office must respond to.
    const hasQuestion =
      /[?؟]/.test(cleanBody) ||
      /\b(האם|למה|מתי|איפה|איך|מדוע|כמה|מי|מה)\b/.test(cleanBody) ||
      /אני\s+טועה/.test(cleanBody) ||
      /(לא\s+הבנתי|לא\s+ברור|זה\s+נכון|אתם\s+בטוחים|אני\s+חושב|אני\s+חושבת|זכור\s+לי|נדמה\s+לי)/.test(cleanBody);

    // Call LLM with tool_use for structured extraction (DL-262)
    const systemPrompt = `You are a CPA office assistant at an Israeli accounting firm. Parse a client email for an internal timeline.

Rules:
- Extract ONLY the new content written by the sender — ignore any quoted previous replies, forwarding headers, or email signatures that may remain
- Write the summary as ONE Hebrew sentence, maximum 15 words
- Focus on: what the client wants/needs, any urgency, documents or forms mentioned
- Always summarize in Hebrew, even if the email is in English
- clean_text should contain only the client's own words, in the original language
- Set skip=true ONLY if the email has no meaningful client communication (auto-replies, delivery receipts, signature-only, attachment-only with no prose, or forwarded without new text)
- NEVER skip if the client asks a question, expresses doubt, disputes a claim, asks for clarification, or pushes back — even short messages like "אני טועה?" or "זה נכון?" must be kept`;

    const tool = {
      name: 'parse_client_email',
      description: 'Extract structured data from a client email',
      input_schema: {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' as const, description: 'One Hebrew sentence summarizing what the client is saying/asking (max 15 words)' },
          clean_text: { type: 'string' as const, description: 'Only the new message content written by the sender, no quotes or signatures, in original language' },
          skip: { type: 'boolean' as const, description: 'True if email has no meaningful client communication' },
        },
        required: ['summary', 'clean_text', 'skip'],
      },
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': pCtx.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'parse_client_email' },
        messages: [{
          role: 'user',
          content: `Email subject: ${subject}\nEmail body:\n${cleanBody}`,
        }],
      }),
    });

    let summary = '';
    let cleanText = '';
    if (resp.ok) {
      const data = (await resp.json()) as {
        content?: Array<{ type: string; input?: Record<string, unknown> }>;
      };
      const toolBlock = data.content?.find((b) => b.type === 'tool_use');
      if (toolBlock?.input) {
        if (toolBlock.input.skip && !hasCredential && !hasQuestion) {
          logSkip('llm_skip');
          return;
        }
        summary = String(toolBlock.input.summary || '');
        cleanText = String(toolBlock.input.clean_text || '');
        // If the LLM tried to skip a credential- or question-bearing email,
        // force a sensible summary + raw_snippet from the cleaned body itself.
        if (toolBlock.input.skip && (hasCredential || hasQuestion)) {
          if (!summary) {
            const fallback = hasQuestion ? 'שאלה מהלקוח' : 'סיסמה למסמך';
            summary = subject || cleanBody.split('\n')[0] || fallback;
          }
          if (!cleanText) cleanText = cleanBody;
        }
      }
    }

    // Fallback to subject
    if (!summary) {
      summary = subject.substring(0, 200);
    }

    // Create note entry (matches n8n Build Client Note format)
    const entry = {
      id: `cn_${Date.now()}`,
      date: new Date().toISOString(),
      summary: truncateSummary(summary),
      source: 'email',
      message_id: msgId,
      conversation_id: metadata.conversationId || null,
      sender_email: clientEmail,
      raw_snippet: (cleanText || cleanBody).substring(0, 1000),
    };
    notes.push(entry);

    await pCtx.airtable.updateRecord(TABLES.REPORTS, report.reportRecordId, {
      client_notes: JSON.stringify(notes),
    });

    // DL-365 Phase 2: success-path activity event for the inbound note pipeline.
    logEvent({
      event_type: 'inbound_note_saved',
      category: 'INBOUND',
      source: 'worker',
      client_id: clientId,
      endpoint: '/inbound/note-save',
      details: { message_id: msgId, report_id: report.reportRecordId, note_count: notes.length },
    });
  } catch (err) {
    console.error('[inbound] summarizeAndSaveNote failed:', (err as Error).message);
    logError(pCtx.ctx, pCtx.env, {
      endpoint: '/inbound/note-save',
      error: err,
      category: 'INTERNAL',
      details: JSON.stringify({ message_id: msgId, report_id: report.reportRecordId, client_id: clientId }),
    });
  }
}

// ---------------------------------------------------------------------------
// Per-attachment processing
// ---------------------------------------------------------------------------

/** Hebrew title map — imported from document-classifier.ts SSOT */
const HE_TITLE = TEMPLATE_TITLES;

/** Sanitize for OneDrive filenames (matches n8n's san()) */
function sanitizeForOneDrive(name: string): string {
  return name.replace(/[\\/*<>?:|#"~&{}%]/g, '').replace(/\.+$/, '').trim();
}

/**
 * Build expected filename from classification.
 *
 * DL-355: when a templateMap is available (set on pCtx by processInboundEmail),
 * route through the canonical resolveOneDriveFilename so inbound files use the
 * same `short_name_he` shape as approve/reassign/admin-upload paths. Falls back
 * to the legacy HE_TITLE-based naming when no templateMap is available
 * (defensive — happens for callers that haven't populated it).
 */
function buildExpectedFilename(
  templateId: string | null,
  issuerName: string,
  originalName: string,
  templateMap?: Map<string, import('../doc-builder').TemplateInfo>,
): string | null {
  if (!templateId) return null;
  if (templateMap) {
    return resolveOneDriveFilename({
      templateId,
      issuerName,
      attachmentName: originalName,
      templateMap,
    });
  }
  // Legacy fallback (no templateMap)
  const heTitle = HE_TITLE[templateId] || 'מסמך';
  const ext = originalName.split('.').pop() || 'pdf';
  let base = sanitizeForOneDrive(heTitle);
  if (issuerName) base += ' - ' + sanitizeForOneDrive(issuerName);
  return `${base}.${ext}`;
}

/**
 * DL-420: fallback pending_classifications row for attachments that never made
 * it through the happy path (classify failure, upload failure, or `tooLarge`
 * Drive stub). The office's only inbox for inbound docs is the AI Review tab —
 * if we don't write a PC, the file effectively does not exist for them.
 *
 * `failureReason` is surfaced verbatim in `ai_reason` so the office sees what
 * went wrong. For `tooLarge` stubs we set `file_url` to the original Drive URL
 * so the "open" button in AI Review takes the office straight to the file.
 */
async function createFallbackPendingClassification(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  metadata: EmailMetadata,
  clientMatch: { clientId: string; clientName: string },
  report: ActiveReport,
  emailEventRecordId: string,
  classification: ClassificationResult | null,
  failureReason: string,
): Promise<void> {
  const classificationKey = `${clientMatch.clientId || 'unknown'}-${report.year}-${attachment.name}-dl420-${Date.now()}`;
  const isTooLarge = !!attachment.tooLarge;
  const fields: Record<string, unknown> = {
    classification_key: classificationKey,
    report: [report.reportRecordId],
    document: [],
    email_event: emailEventRecordId ? [emailEventRecordId] : [],
    attachment_name: attachment.name,
    attachment_content_type: attachment.contentType,
    attachment_size: attachment.size,
    sender_email: metadata.senderEmail,
    sender_name: metadata.senderName,
    received_at: metadata.receivedAt,
    matched_template_id: null,
    ai_confidence: classification?.confidence ?? 0,
    ai_reason: `[DL-420] ${failureReason}`,
    issuer_name: classification?.issuerName ?? '',
    file_url: attachment.driveUrl ?? '',
    onedrive_item_id: '',
    file_hash: attachment.sha256 || '',
    review_status: 'pending',
    client_name: clientMatch.clientName,
    client_id: clientMatch.clientId,
    year: report.year,
    expected_filename: attachment.name,
    notes: isTooLarge
      ? '⚠️ קובץ גדול מדי להורדה אוטומטית — פתח בקישור Drive'
      : '⚠️ שגיאת עיבוד — דרוש סיווג ידני',
    email_body_text: (metadata.bodyPreview || '').substring(0, 500),
  };
  await pCtx.airtable.createRecords(TABLES.PENDING_CLASSIFICATIONS, [{ fields }]);
}

/** Process a single attachment with a pre-computed classification result (from parallel Phase A) */
async function processAttachmentWithClassification(
  pCtx: ProcessingContext,
  attachment: AttachmentInfo,
  metadata: EmailMetadata,
  clientMatch: { clientId: string; clientName: string },
  report: ActiveReport,
  requiredDocs: AirtableRecord<DocFields>[],
  emailEventRecordId: string,
  oneDriveRoot: OneDriveRoot,
  classification: ClassificationResult | null,
  provenanceNote?: string,
  outcome?: { pcCreated: boolean },
): Promise<void> {
  // DL-321: Short-circuit non-document images (decorative headers, signature images, blank pages).
  // Classifier can explicitly set isDocument=false when the attachment has no document content.
  // Guardrails: image-only (PDFs always reach review), confidence >= 0.8 (low-confidence non-doc
  // verdicts fall through to human review). Over-refusal is the primary risk — bias toward review.
  if (
    classification
    && classification.isDocument === false
    && classification.confidence >= 0.8
    && IMAGE_EXTENSIONS.has(getFileExtension(attachment.name))
  ) {
    console.warn(
      `[inbound][DL-321] non-document short-circuit: `
      + `name="${attachment.name}" size=${attachment.size} `
      + `reason=${classification.nonDocumentReason ?? 'unknown'} `
      + `conf=${classification.confidence} client=${clientMatch.clientId} `
      + `evidence="${(classification.reason || '').slice(0, 120)}"`
    );
    // DL-420: intentional skip (decorative/signature/blank-page image) — the
    // file legitimately doesn't deserve a PC row, so mark the invariant
    // satisfied to suppress fallback creation.
    if (outcome) outcome.pcCreated = true;
    return;
  }

  // Step 2: Hash dedup (Layer 2) — but still create record if duplicate (with warning)
  // Exclude records from the current email event to avoid false positives
  const dupResult = await checkFileHashDuplicate(
    pCtx.airtable,
    attachment.sha256,
    report.reportRecordId,
    emailEventRecordId,
  );
  const isDuplicate = dupResult.isDuplicate;

  // Step 3: All docs go directly to filing type folder root (DL-240)

  // Step 4: Build expected filename (DL-355: uses short_name_he via pCtx.templateMap)
  let expectedFilename = buildExpectedFilename(
    classification?.templateId ?? null,
    classification?.issuerName ?? '',
    attachment.name,
    pCtx.templateMap,
  );
  const uploadName = expectedFilename || attachment.name;

  // Step 5: Convert images to PDF before upload (Tier 1 — matches n8n Image to PDF node)
  let contentToUpload = attachment.content;
  let finalUploadName = uploadName;
  const ext = getFileExtension(attachment.name);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  let conversionFailed = false;
  let conversionError = '';

  if (isImage && !isDuplicate) {
    try {
      const pdfBytes = await imageToPdf(
        new Uint8Array(attachment.content),
        attachment.contentType,
      );
      if (pdfBytes) {
        contentToUpload = pdfBytes.buffer as ArrayBuffer;
        finalUploadName = finalUploadName.replace(/\.(jpe?g|png|tif|tiff|heic)$/i, '.pdf');
        // Update expected filename extension too
        if (expectedFilename) {
          expectedFilename = expectedFilename.replace(/\.(jpe?g|png|tif|tiff|heic)$/i, '.pdf');
        }
      }
    } catch (err) {
      console.error(`[inbound] Image→PDF failed for ${attachment.name}:`, (err as Error).message);
      conversionFailed = true;
      conversionError = (err as Error).message;
      // Continue with original image
    }
  }

  // Step 6: Upload to OneDrive (skip if duplicate — inherit file info from original)
  let upload = {
    webUrl: dupResult.fileUrl || '',
    itemId: dupResult.itemId || '',
    downloadUrl: '',
  };
  if (!isDuplicate) {
    upload = await uploadToOneDrive(
      pCtx.graph,
      oneDriveRoot,
      report.clientName,
      String(report.year),
      finalUploadName,
      contentToUpload,
      report.filingType,
    );
  }

  // Step 7: Office→PDF conversion (Tier 2 — matches n8n Check If PDF → Download → Upload → Delete)
  let officePdfContent: ArrayBuffer | null = null;
  if (!isDuplicate && upload.itemId && OFFICE_CONVERTIBLE.has(ext)) {
    try {
      const driveId = oneDriveRoot.driveId;
      // Download as PDF via Graph API
      const pdfContent = await pCtx.graph.getBinary(
        `/drives/${driveId}/items/${upload.itemId}/content?format=pdf`,
      );
      if (pdfContent && pdfContent.byteLength > 0) {
        // Get parent folder ID from the uploaded item
        const itemInfo = await pCtx.graph.get(`/drives/${driveId}/items/${upload.itemId}?$select=parentReference`);
        const parentId = itemInfo?.parentReference?.id;

        if (parentId) {
          const pdfName = finalUploadName.replace(/\.[^.]+$/, '.pdf');
          // Upload PDF to same folder
          const pdfUpload = await pCtx.graph.putBinary(
            `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(pdfName)}:/content`,
            pdfContent,
          );
          // Delete original non-PDF file
          await pCtx.graph.delete(`/drives/${driveId}/items/${upload.itemId}`);
          // Use the PDF's info
          upload = {
            webUrl: pdfUpload.webUrl ?? upload.webUrl,
            itemId: pdfUpload.id ?? upload.itemId,
            downloadUrl: pdfUpload['@microsoft.graph.downloadUrl'] ?? '',
          };
          finalUploadName = pdfName;
          officePdfContent = pdfContent; // DL-237: retain for page count
        }
      }
    } catch (err) {
      console.error(`[inbound] Office→PDF failed for ${attachment.name}:`, (err as Error).message);
      conversionFailed = true;
      conversionError = (err as Error).message;
      // Keep the original uploaded file
    }
  }

  // Step 7b: Detect PDF page count (for split feature — DL-237)
  // For native PDFs and image→PDF: contentToUpload has valid PDF bytes.
  // For office→PDF: contentToUpload is the original office file; use officePdfContent instead.
  let pageCount: number | null = null;
  const finalIsPdf = /\.pdf$/i.test(finalUploadName);
  if (finalIsPdf && !isDuplicate) {
    try {
      const pdfSource = officePdfContent ?? contentToUpload;
      pageCount = await getPdfPageCount(pdfSource);
    } catch {
      // Non-critical — leave as null if PDF can't be parsed for page count
    }
  }

  // DL-419: free the attachment ArrayBuffer once the upload + Office→PDF
  // download/page-count phases have completed. attachments[] holds one entry
  // per file in the email — without this, an 8-attachment email accumulates
  // 5+ MB ArrayBuffers across the whole processAttachment loop and pushes the
  // isolate past the 128 MB Workers cap during the NEXT attachment's PUT.
  // Skip when isDuplicate (we didn't allocate fresh upload memory anyway).
  if (!isDuplicate) {
    attachment.content = new ArrayBuffer(0);
    contentToUpload = new ArrayBuffer(0);
    officePdfContent = null;
  }

  // Step 8: Create pending classification record (all fields matching n8n)
  // DL-419: when classification was skipped due to oversize, surface a Hebrew
  // sentinel in matched_doc_name so the office sees the row in AI Review with
  // an unmistakable manual-sort hint. matched_template_id stays null so the
  // existing reassign flow (DL-412) handles it normally.
  const isOversizeNoAI = !classification && attachment.size > MAX_CLASSIFIABLE_BYTES;
  const classificationKey = `${clientMatch.clientId || 'unknown'}-${report.year}-${attachment.name}`;
  const classFields: Record<string, unknown> = {
    classification_key: classificationKey,
    report: [report.reportRecordId],
    document: classification?.matchedDocRecordId ? [classification.matchedDocRecordId] : [],
    email_event: emailEventRecordId ? [emailEventRecordId] : [],
    attachment_name: attachment.name,
    attachment_content_type: attachment.contentType,
    attachment_size: attachment.size,
    sender_email: metadata.senderEmail,
    sender_name: metadata.senderName,
    received_at: metadata.receivedAt,
    matched_template_id: classification?.templateId ?? null,
    ai_confidence: classification?.confidence ?? 0,
    ai_reason: isOversizeNoAI ? '[DL-419] Skipped AI classification (oversize)' : (classification?.reason ?? ''),
    issuer_name: classification?.issuerName ?? '',
    file_url: upload.webUrl,
    onedrive_item_id: upload.itemId,
    file_hash: attachment.sha256,
    review_status: 'pending',
    client_name: clientMatch.clientName,
    client_id: clientMatch.clientId,
    year: report.year,
    expected_filename: expectedFilename,
    issuer_match_quality: classification?.matchQuality ?? null,
    matched_doc_name: classification?.matchedDocName ?? (isOversizeNoAI ? OVERSIZE_SENTINEL_DOC_NAME : null),
    notes: [
      isDuplicate ? '⚠️ קובץ כפול — אותו קובץ כבר קיים במערכת' : '',
      provenanceNote ?? '',
    ].filter(Boolean).join(' | '),
    is_duplicate: isDuplicate,
    email_body_text: (metadata.bodyPreview || '').substring(0, 500),
    conversion_failed: conversionFailed,
    conversion_error: conversionError || undefined,
    page_count: pageCount,
    contract_period: classification?.contractPeriod ? JSON.stringify(classification.contractPeriod) : null,
    // DL-315: flag when the classifier ran against the full filing-type catalog
    // because the client has not submitted the questionnaire yet.
    pre_questionnaire: classification?.preQuestionnaire ?? false,
  };

  // DL-409: when the file_hash already exists in documents (Received) or
  // pending_classifications (queue twin), silently skip creating a fresh
  // queue row. Prior behavior added redundant rows that polluted AI-review.
  if (isDuplicate) {
    logEvent({
      event_type: 'attachment_duplicate_skipped',
      category: 'INBOUND',
      source: 'worker',
      client_id: clientMatch.clientId,
      endpoint: '/inbound/process-attachment',
      details: {
        template_id: classification?.templateId ?? null,
        confidence: classification?.confidence ?? null,
        duplicate_match: dupResult.source ?? null,
        file_hash_prefix: attachment.sha256?.slice(0, 12),
        report_id: report.reportRecordId,
        attachment_name: attachment.name,
      },
    });
    // DL-420: duplicate skip — the original PC/document already represents
    // this attachment, so the invariant is satisfied; do NOT create a fallback.
    if (outcome) outcome.pcCreated = true;
    return;
  }

  await pCtx.airtable.createRecords(TABLES.PENDING_CLASSIFICATIONS, [
    { fields: classFields },
  ]);
  if (outcome) outcome.pcCreated = true;

  // Step 7: Update document record if matched (and not duplicate)
  if (classification?.matchedDocRecordId && !isDuplicate) {
    await pCtx.airtable.updateRecord(
      TABLES.DOCUMENTS,
      classification.matchedDocRecordId,
      {
        review_status: 'pending_review',
        ai_confidence: classification.confidence,
        ai_reason: classification.reason,
        file_url: upload.webUrl,
        onedrive_item_id: upload.itemId,
        file_hash: attachment.sha256,
        source_attachment_name: attachment.name,
        source_sender_email: metadata.senderEmail,
        source_message_id: pCtx.messageId,
        source_internet_message_id: metadata.internetMessageId,
        uploaded_at: new Date().toISOString(),
      },
    );
  }

  // DL-365 Phase 2: classification + OneDrive upload success event.
  logEvent({
    event_type: 'attachment_classified',
    category: 'AI',
    source: 'worker',
    client_id: clientMatch.clientId,
    endpoint: '/inbound/process-attachment',
    details: {
      template_id: classification?.templateId ?? null,
      confidence: classification?.confidence ?? null,
      matched: Boolean(classification?.matchedDocRecordId),
      duplicate: isDuplicate,
      report_id: report.reportRecordId,
    },
  });
}

// ---------------------------------------------------------------------------
// Password-reply fast-path (DL-380)
// ---------------------------------------------------------------------------

/**
 * Detect and handle emails that are replies to an encrypted-PDF password
 * request.  Matches [#PWD-token] in subject or body (DL-380/DL-382).
 * DL-382: looks up by password_request_token field (fan-out to N records).
 * If matched and the email has no attachments the caller should stop
 * processing; if attachments are present the normal pipeline must also run.
 */
async function tryHandlePasswordReply(
  subject: string,
  bodyText: string,
  hasAttachments: boolean,
  emailEventId: string | undefined,
  airtable: AirtableClient,
  senderEmail?: string,
  internetMessageId?: string,
): Promise<{ handled: boolean }> {
  // 1. Match token in subject first, then body (token lives in email body footer)
  const tokenMatch = subject.match(/\[#PWD-([A-Za-z0-9]{6,12})\]/i)
    || bodyText.match(/\[#PWD-([A-Za-z0-9]{6,12})\]/i);
  if (!tokenMatch) return { handled: false };
  const token = tokenMatch[1];

  // 2. Look up pending_classifications by password_request_token field (DL-382)
  let records: AirtableRecord[];
  try {
    records = await airtable.listAllRecords(TABLES.PENDING_CLASSIFICATIONS, {
      filterByFormula: `{password_request_token}='${token.replace(/'/g, "\\'")}'`,
    });
  } catch (err) {
    console.warn('[inbound][DL-382] pending_classifications lookup failed:', (err as Error).message);
    return { handled: false };
  }

  if (records.length === 0) {
    console.warn(`[inbound][DL-382] No pending_classifications record found for token ${token}`);
    return { handled: false };
  }

  // 3. Extract password candidate from body text.
  // Process line-by-line, stopping at the Gmail quote header so filenames
  // from the original quoted email don't get mistaken for the password.
  // Handles Unicode RTL control chars that Gmail/Outlook prepend to "בתאריך".
  const truncated = bodyText.substring(0, 1000);
  const allLines = truncated.replace(/<[^>]+>/g, '').split('\n');
  const replyLines: string[] = [];
  for (const raw of allLines) {
    const l = raw.trim();
    if (!l) continue;
    // Stop at Gmail quote header (Hebrew RTL-embedded or English)
    if (/^[​-‏‪-‮]*בתאריך/.test(l) || /^On .+wrote:/.test(l) || l.startsWith('>')) break;
    replyLines.push(l);
  }
  // Fall back to all clean lines for bottom-posted or unusual reply formats
  const searchLines = replyLines.length > 0
    ? replyLines
    : allLines.map((l) => l.trim()).filter(
        (l) => l.length > 0 && !l.startsWith('>') && !/^---.*---$/.test(l)
      );

  const hebrewRe = /[א-ת]/;
  let suggestedPassword =
    searchLines.find((l) => l.length <= 32 && !hebrewRe.test(l) && !l.includes(' ')) ?? '';
  if (!suggestedPassword) {
    suggestedPassword = searchLines.find((l) => l.length <= 32) ?? '';
  }

  suggestedPassword = suggestedPassword.substring(0, 64);
  // DL-384: persist the stripped reply (not the quoted original PWD request),
  // so admin surfaces render only the client's actual message. Falls back to
  // searchLines for bottom-posted replies so the field is never empty.
  const strippedReply = (replyLines.length > 0 ? replyLines : searchLines).join('\n');
  const passwordReplyRaw = strippedReply.substring(0, 1000);

  // 4. Fan out: write suggested_password + raw reply to ALL matched records
  await Promise.allSettled(
    records.map(r =>
      airtable.updateRecord(TABLES.PENDING_CLASSIFICATIONS, r.id, {
        suggested_password: suggestedPassword,
        password_reply_raw: passwordReplyRaw,
      }).catch(err => {
        console.warn(`[inbound][DL-382] Failed to update record ${r.id}:`, (err as Error).message);
      }),
    ),
  );

  // 5. Update email_events processing_status
  if (emailEventId) {
    try {
      await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
        processing_status: 'PasswordReply',
      });
    } catch (err) {
      console.warn('[inbound][DL-382] Failed to update email_events status:', (err as Error).message);
    }
  }

  // 6. Log activity event
  logEvent({
    event_type: 'pdf_password_reply_received',
    category: 'INBOUND',
    details: { token, recordIds: records.map(r => r.id), count: records.length, hasAttachments },
  });

  console.log(`[inbound][DL-382] Password reply handled for token ${token}, ${records.length} record(s) updated`);

  // 7. Write a client_notes entry on the linked annual_report so the reply
  //    appears in the admin panel notes — same JSON format as summarizeAndSaveNote.
  const reportIds = [...new Set(
    records.flatMap(r => (r.fields.report as string[] | undefined) ?? [])
  )];
  for (const reportId of reportIds) {
    try {
      const reportRec = await airtable.getRecord(TABLES.REPORTS, reportId);
      const existing = (reportRec.fields.client_notes as string | undefined) ?? '[]';
      let notes: Array<Record<string, unknown>> = [];
      try { notes = JSON.parse(existing); if (!Array.isArray(notes)) notes = []; } catch { notes = []; }
      notes.push({
        id: `cn_${Date.now()}`,
        date: new Date().toISOString(),
        summary: 'תגובת לקוח לבקשת סיסמה',
        source: 'email',
        message_id: internetMessageId ?? null,
        sender_email: senderEmail ?? null,
        conversation_id: null,
        raw_snippet: passwordReplyRaw,
      });
      await airtable.updateRecord(TABLES.REPORTS, reportId, { client_notes: JSON.stringify(notes) });
    } catch (err) {
      console.warn(`[inbound][DL-382] Failed to write client_note for report ${reportId}:`, (err as Error).message);
    }
  }

  // If email also has attachments, let the normal pipeline process them
  if (hasAttachments) {
    return { handled: false };
  }
  return { handled: true };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function processInboundEmail(
  env: Env,
  ctx: ExecutionContext,
  messageId: string,
): Promise<void> {
  const graph = new MSGraphClient(env, ctx);
  const airtable = new AirtableClient(env.AIRTABLE_BASE_ID, env.AIRTABLE_PAT);
  // DL-355: pre-fetch template map so per-attachment filename resolution can use short_name_he
  let templateMap: Map<string, import('../doc-builder').TemplateInfo> | undefined;
  try {
    const templateRecords = await getCachedOrFetch(env.CACHE_KV, 'cache:templates', 3600,
      () => airtable.listAllRecords('tblQTsbhC6ZBrhspc'));
    templateMap = buildTemplateMap(templateRecords);
  } catch (e) {
    console.warn('[inbound] template map fetch failed; falling back to HE_TITLE naming:', (e as Error).message);
  }
  const pCtx: ProcessingContext = { env, ctx, graph, airtable, messageId, templateMap };

  let emailEventId = '';

  try {
    // 1. Fetch email from MS Graph
    const email = await graph.get(
      `/users/${MAILBOX}/messages/${messageId}?$select=subject,from,body,bodyPreview,receivedDateTime,hasAttachments,internetMessageId,internetMessageHeaders,conversationId`,
    );

    // 2. Extract metadata
    const metadata = extractMetadata(email, messageId);

    // 3a. Hard bounce (NDR) — clear bad address, revert stage, log. Must run
    // before the auto-reply branch because NDR subjects also trip auto-reply
    // patterns (DL-399).
    if (metadata.bounceInfo?.isHard) {
      await handleHardBounce(airtable, metadata.bounceInfo, messageId);
      await upsertEmailEvent(airtable, metadata, messageId, 'Bounced', [], {});
      return;
    }

    // 3. Filter auto-replies
    if (metadata.isAutoReply) {
      await upsertEmailEvent(airtable, metadata, messageId, 'Completed', [], {});
      return;
    }

    // 3b. Filter own outbound emails (DL-234)
    if (metadata.senderEmail === SYSTEM_SENDER) {
      console.log(`[inbound] Skipping own outbound email: ${messageId}`);
      return;
    }

    // 4. Fetch and filter attachments
    let attachments = await fetchAttachments(graph, messageId);

    // 4a. DL-367: Gmail Drive smart-link attachments. Gmail's "Insert from
    // Drive" embeds inline chip cards in the body HTML (hasAttachments=false,
    // 0 Graph attachments). Parse them out and fetch via Drive's anonymous
    // public-download endpoint, then merge into the standard attachments array.
    const driveLinks = parseDriveLinks(email.body?.content ?? '');
    const driveFailures: Array<{ fileId: string; filename: string; error: string; url: string }> = [];
    let driveSuccessCount = 0;
    if (driveLinks.length > 0) {
      console.log(`[inbound][DL-367] Found ${driveLinks.length} Gmail Drive chip(s) for message ${messageId}`);
      for (const link of driveLinks) {
        const r = await fetchDriveAttachment(link);
        if (r.ok) {
          attachments.push(r.attachment);
          driveSuccessCount++;
          console.log(`[inbound][DL-367] Fetched ${link.filename} (${r.attachment.size} bytes)`);
        } else {
          const driveUrl = `https://drive.google.com/file/d/${link.fileId}/view`;
          driveFailures.push({
            fileId: link.fileId,
            filename: link.filename,
            error: r.error,
            url: driveUrl,
          });
          console.warn(`[inbound][DL-367] Drive fetch failed for ${link.filename}: ${r.error}`);
          // DL-420: too_large Drive files MUST still appear in AI Review. Synthesize
          // a stub attachment so the per-attachment loop creates a metadata-only PC
          // whose file_url points back to Drive. Other Drive errors (permission /
          // network) stay in driveFailures and surface via NeedsHuman + error_message.
          if (r.error === 'too_large') {
            attachments.push({
              id: `drive:${link.fileId}`,
              name: link.filename,
              contentType: 'application/pdf',
              size: 0,
              content: new ArrayBuffer(0),
              sha256: '',
              tooLarge: true,
              driveUrl,
            });
          }
        }
        // Polite spacing between Drive requests
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Detect "ghost attachments": Gmail Drive smart-links / itemAttachment
    // forwards arrive with hasAttachments=true but produce 0 readable files.
    // Without this guard the email completes silently and the docs disappear.
    // DL-367: also fire when Drive links were parsed but ALL fetches failed.
    const ghostAttachments =
      (!!email.hasAttachments && attachments.length === 0) ||
      (driveLinks.length > 0 && driveSuccessCount === 0);

    // 4b. Expand archives (ZIP/RAR/7z) into individual files (DL-260)
    const archiveResult = await expandArchiveAttachments(attachments);
    if (archiveResult.log.length > 0) {
      console.log(`[inbound] Archive expansion: ${archiveResult.log.length} entries, ${archiveResult.failedArchives.length} failed`);
      for (const entry of archiveResult.log) {
        console.log(`[inbound]   ${entry.archive}: ${entry.action}${entry.file ? ` — ${entry.file}` : ''}${entry.reason ? ` (${entry.reason})` : ''}`);
      }
    }
    attachments = archiveResult.attachments;

    // 5. Mark as read
    await graph.patch(`/users/${MAILBOX}/messages/${messageId}`, { isRead: true });

    // 6. Create email event (status: Detected)
    emailEventId = await upsertEmailEvent(airtable, metadata, messageId, 'Detected', attachments);

    // 6b. DL-380: Fast-path for password replies — must run before client lookup
    const pwdResult = await tryHandlePasswordReply(
      metadata.subject,
      metadata.bodyText,
      metadata.hasAttachments,
      emailEventId,
      airtable,
      metadata.senderEmail,
      metadata.internetMessageId,
    );
    if (pwdResult.handled) {
      return;
    }

    // 7. Identify client
    const clientMatch = await identifyClient(pCtx, metadata, attachments.map(a => a.name));

    // Update email event with match method (only fields that exist in the table)
    await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
      match_method: clientMatch.matchMethod,
    });

    // 8. Handle unidentified client (DL-361)
    // Upload to לקוח לא מזוהה folder AND create a pending_classifications row per
    // attachment so the email surfaces in the AI Review tab as a virtual accordion.
    // The office can then assign-to-client via /webhook/assign-unidentified, which
    // re-classifies + moves the OneDrive files into the correct client folder.
    if (clientMatch.matchMethod === 'unidentified') {
      const unidentifiedRoot = await resolveOneDriveRoot(graph);
      const yearStr = String(new Date().getFullYear());
      for (const att of attachments) {
        try {
          const upload = await uploadToOneDrive(
            graph,
            unidentifiedRoot,
            'לקוח לא מזוהה',
            yearStr,
            att.name,
            att.content,
          );
          await airtable.createRecords(TABLES.PENDING_CLASSIFICATIONS, [{
            fields: {
              classification_key: `unidentified-${emailEventId}-${att.name}`,
              report: [],
              document: [],
              email_event: emailEventId ? [emailEventId] : [],
              attachment_name: att.name,
              attachment_content_type: att.contentType,
              attachment_size: att.size,
              sender_email: metadata.senderEmail,
              sender_name: metadata.senderName,
              received_at: metadata.receivedAt,
              matched_template_id: null,
              ai_confidence: 0,
              ai_reason: 'unidentified — awaiting client assignment',
              issuer_name: '',
              file_url: upload.webUrl,
              onedrive_item_id: upload.itemId,
              file_hash: att.sha256,
              review_status: 'pending',
              client_name: 'לקוח לא מזוהה',
              client_id: '',
              year: parseInt(yearStr, 10),
              expected_filename: att.name,
              email_body_text: (metadata.bodyPreview || '').substring(0, 500),
            },
          }]);
        } catch (err) {
          console.error(`[inbound] Unidentified upload/row failed for "${att.name}": ${(err as Error).message}`);
        }
      }
      await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
        processing_status: 'NeedsHuman',  // Valid option in email_events.processing_status
      });
      return;
    }

    // 9. Get ALL reports for client (any stage — for note capture)
    const allReports = await getAllReports(airtable, clientMatch.clientId);
    if (allReports.length === 0) {
      console.log(`[inbound] No report at all for client ${clientMatch.clientName}`);
      await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
        processing_status: 'NeedsHuman',
      });
      return;
    }

    // Primary report for notes (highest year)
    allReports.sort((a, b) => b.year - a.year);
    const primaryReport = allReports[0];

    // 9b. Filter to classifiable reports (stages 1-4: up to Collecting_Docs)
    const activeReports = allReports.filter(
      r => r.stage === 'Send_Questionnaire' || r.stage === 'Waiting_For_Answers' || r.stage === 'Pending_Approval' || r.stage === 'Collecting_Docs'
    );

    // 10. Resolve OneDrive shared folder root
    const oneDriveRoot = await resolveOneDriveRoot(graph);

    // 11b. Get existing client_notes from primary report for dedup
    const reportRecord = await airtable.getRecord<ReportFields>(TABLES.REPORTS, primaryReport.reportRecordId);
    const existingClientNotes = reportRecord.fields.client_notes ?? '[]';
    const reportClientEmail = Array.isArray(reportRecord.fields.client_email)
      ? (reportRecord.fields.client_email[0] ?? '').toLowerCase()
      : (reportRecord.fields.client_email ?? '').toLowerCase();

    // 12. LLM summarize email → save client note (always, any stage)
    // DL-282: match-method-aware sender resolution — never surface the forwarder
    const noteSenderEmail = await resolveNoteSenderEmail(airtable, reportClientEmail, clientMatch);
    const notePromise = summarizeAndSaveNote(pCtx, metadata, primaryReport, existingClientNotes, noteSenderEmail, clientMatch.clientId).catch((err) => {
      console.error('[inbound] Note save failed:', (err as Error).message);
    });

    if (activeReports.length > 0) {
    // --- FULL PROCESSING PATH: classification + upload ---

    // 11. Get required docs for active reports, tag each with source report
    const requiredDocsArrays = await Promise.all(
      activeReports.map(async (rpt) => {
        const docs = await airtable.listAllRecords<DocFields>(TABLES.DOCUMENTS, {
          filterByFormula: `AND({report_key_lookup} = '${rpt.reportKey}', {status} = 'Required_Missing')`,
          fields: ['type', 'issuer_name', 'issuer_key', 'person', 'status', 'report_key_lookup', 'expected_filename', 'category'],
        });
        // Tag each doc with its source report record ID
        for (const doc of docs) {
          (doc.fields as Record<string, unknown>)._reportRecordId = rpt.reportRecordId;
        }
        return docs;
      }),
    );
    const requiredDocs = requiredDocsArrays.flat();

    // Build a map from reportRecordId → ActiveReport for routing
    const reportMap = new Map(activeReports.map(r => [r.reportRecordId, r]));

    // 13. Process attachments — parallel classification, sequential upload/write
    if (attachments.length > 0) {
      // Phase A: Classify attachments serially (DL-287: belt-and-suspenders with Queues
      // migration — size=1 + inter-batch 1s delay eliminates 429 storms at source).
      const CLASSIFY_BATCH_SIZE = 1;
      const classificationResults: (ClassificationResult | null)[] = new Array(attachments.length).fill(null);
      for (let batch = 0; batch < attachments.length; batch += CLASSIFY_BATCH_SIZE) {
        const batchEnd = Math.min(batch + CLASSIFY_BATCH_SIZE, attachments.length);
        // DL-315: pre-questionnaire fallback — when client has no required_docs yet
        // (stage Send_Questionnaire / Waiting_For_Answers), classify against the full
        // filing-type catalog instead of skipping.
        const preQuestionnaireStage =
          primaryReport.stage === 'Send_Questionnaire' ||
          primaryReport.stage === 'Waiting_For_Answers';
        const fallbackMode = requiredDocs.length === 0 || preQuestionnaireStage;
        const batchPromises = attachments.slice(batch, batchEnd).map(async (attachment) => {
          // DL-419: skip AI classification for oversize attachments. The
          // pending_classifications row will still be created (Phase B below)
          // with matched_template_id=null + a Hebrew sentinel in
          // matched_doc_name so the office triages manually in AI Review.
          if (attachment.size > MAX_CLASSIFIABLE_BYTES) {
            const sizeMB = Math.round(attachment.size / 1024 / 1024);
            const limitMB = Math.round(MAX_CLASSIFIABLE_BYTES / 1024 / 1024);
            console.warn(`[inbound][DL-419] Skipping AI classification for "${attachment.name}" (${sizeMB}MB > ${limitMB}MB) — pending_classifications row will be created with manual-sort sentinel`);
            return null;
          }
          try {
            return await classifyAttachment(pCtx, attachment, requiredDocs, primaryReport.clientName, {
              subject: metadata.subject,
              bodyPreview: metadata.bodyPreview,
              senderName: metadata.senderName,
              senderEmail: metadata.senderEmail,
              fallbackMode,
              filingType: primaryReport.filingType,
            });
          } catch (err) {
            console.error(`[inbound] Classification failed for "${attachment.name}":`, (err as Error).message);
            return null;
          }
        });
        const batchResults = await Promise.all(batchPromises);
        for (let i = 0; i < batchResults.length; i++) {
          classificationResults[batch + i] = batchResults[i];
        }
        // DL-277: 1s delay between classification batches to avoid Anthropic 429 rate limits
        if (batchEnd < attachments.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // Phase B: Upload and create records sequentially (avoids OneDrive/Airtable rate limits)
      // Route each attachment to the correct report based on matched template prefix
      // Supports dual-filing: one attachment may match both AR and CS (DL-225)
      //
      // DL-420 invariant: every attachment MUST end up with a pending_classifications
      // row, regardless of classify/upload failures. The office's only inbox is AI
      // Review; if a row isn't there, the file effectively does not exist to them.
      // `failedAttachments` accumulates so we can stamp the count on email_events.
      const failedAttachments: Array<{ name: string; reason: string }> = [];

      for (let i = 0; i < attachments.length; i++) {
        const currentAtt = attachments[i];

        // DL-420: too_large Drive stubs never had bytes — skip classify+upload and
        // write a metadata-only PC that points back at the Drive link.
        if (currentAtt.tooLarge) {
          try {
            await createFallbackPendingClassification(
              pCtx,
              currentAtt,
              metadata,
              { clientId: clientMatch.clientId, clientName: clientMatch.clientName },
              primaryReport,
              emailEventId,
              null,
              'Too large to fetch from Drive — open via link',
            );
          } catch (pcErr) {
            console.error(`[inbound][DL-420] tooLarge PC create failed for "${currentAtt.name}":`, (pcErr as Error).message);
          }
          failedAttachments.push({ name: currentAtt.name, reason: 'too_large (Drive)' });
          continue;
        }

        const outcome = { pcCreated: false };
        try {
          const classification = classificationResults[i];
          let targetReport = primaryReport;

          if (classification?.templateId) {
            // CS-T* templates → capital_statement report; T* → annual_report
            const isCS = classification.templateId.startsWith('CS-');
            const matchedReport = activeReports.find(r =>
              isCS ? r.filingType === 'capital_statement' : r.filingType !== 'capital_statement'
            );
            if (matchedReport) targetReport = matchedReport;

            // Also check the matched doc's tagged report (from merged requiredDocs)
            if (classification.matchedDocRecordId) {
              const matchedDoc = requiredDocs.find(d => d.id === classification.matchedDocRecordId);
              const docReportId = (matchedDoc?.fields as Record<string, unknown>)?._reportRecordId as string | undefined;
              if (docReportId && reportMap.has(docReportId)) {
                targetReport = reportMap.get(docReportId)!;
              }
            }
          }

          // Build provenance note for files extracted from archives (DL-260)
          const sourceArchive = archiveResult.sourceArchiveMap.get(attachments[i].name);
          const provenance = sourceArchive ? `📦 חולץ מ: ${sourceArchive}` : undefined;

          // Process primary classification
          await processAttachmentWithClassification(
            pCtx,
            attachments[i],
            metadata,
            { clientId: clientMatch.clientId, clientName: clientMatch.clientName },
            targetReport,
            requiredDocs,
            emailEventId,
            oneDriveRoot,
            classification,
            provenance,
            outcome,
          );

          // Process additional matches (dual-filing — DL-225)
          if (classification?.additionalMatches?.length) {
            for (const am of classification.additionalMatches) {
              const amIsCS = am.templateId.startsWith('CS-');
              const amReport = activeReports.find(r =>
                amIsCS ? r.filingType === 'capital_statement' : r.filingType !== 'capital_statement'
              );
              // Skip if no matching report exists (client doesn't have this filing type)
              if (!amReport) continue;
              // Skip if same report as primary (avoid duplicate)
              if (amReport.reportRecordId === targetReport.reportRecordId) continue;

              // Build a ClassificationResult for the additional match
              const amClassification: typeof classification = {
                templateId: am.templateId,
                confidence: am.confidence,
                reason: am.evidence,
                issuerName: am.issuerName,
                matchedDocRecordId: am.matchedDocRecordId ?? null,
                matchedDocName: am.matchedDocName ?? null,
                matchQuality: am.matchQuality ?? null,
              };

              console.log(`[inbound] Dual-filing: additional match ${am.templateId} for report ${amReport.reportKey}`);

              await processAttachmentWithClassification(
                pCtx,
                attachments[i],
                metadata,
                { clientId: clientMatch.clientId, clientName: clientMatch.clientName },
                amReport,
                requiredDocs,
                emailEventId,
                oneDriveRoot,
                amClassification,
                provenance,
              );
            }
          }
        } catch (err) {
          const errMsg = (err as Error).message;
          console.error(
            `[inbound] Attachment "${attachments[i].name}" failed:`,
            errMsg,
          );
          // DL-420: the loop body threw before/during the PC create. If no PC
          // landed yet, write a fallback so the office still sees the file in
          // AI Review. Diagnostics live in `ai_reason`.
          if (!outcome.pcCreated) {
            try {
              await createFallbackPendingClassification(
                pCtx,
                attachments[i],
                metadata,
                { clientId: clientMatch.clientId, clientName: clientMatch.clientName },
                primaryReport,
                emailEventId,
                classificationResults[i],
                `Processing failed: ${errMsg}`.slice(0, 500),
              );
            } catch (pcErr) {
              console.error(
                `[inbound][DL-420] fallback PC create failed for "${attachments[i].name}":`,
                (pcErr as Error).message,
              );
            }
          }
          failedAttachments.push({ name: attachments[i].name, reason: errMsg.slice(0, 200) });
          // Continue with next attachment
        }
      }

      // DL-420: surface per-attachment failures on the email_events row so the
      // DL-417 dev widget can show a "❗ N failed" badge alongside Completed.
      // `typecast:true` auto-creates these fields on first PATCH; subsequent
      // reads must gate in JS until Airtable confirms field existence
      // (memory: feedback_airtable_typecast_field_existence).
      if (failedAttachments.length > 0 && emailEventId) {
        try {
          await airtable.updateRecord(
            TABLES.EMAIL_EVENTS,
            emailEventId,
            {
              attachments_failed_count: failedAttachments.length,
              failed_attachments: failedAttachments
                .map((f) => `${f.name} | ${f.reason}`)
                .join('\n')
                .slice(0, 5000),
            },
            { typecast: true },
          );
        } catch (e) {
          console.warn('[inbound][DL-420] failed to stamp attachments_failed_count:', (e as Error).message);
        }
      }
    }

    } else if (attachments.length > 0) {
      // --- RAW UPLOAD PATH: no classifiable reports, upload files without classification ---
      console.log(`[inbound] No active report for ${primaryReport.clientName} (stage: ${primaryReport.stage}) — raw upload ${attachments.length} file(s)`);
      for (const att of attachments) {
        try {
          await uploadToOneDrive(
            graph,
            oneDriveRoot,
            primaryReport.clientName,
            String(primaryReport.year),
            att.name,
            att.content,
            primaryReport.filingType,
          );
          console.log(`[inbound] Raw upload: ${att.name} → ${primaryReport.clientName}/${primaryReport.year}`);
        } catch (err) {
          console.error(`[inbound] Raw upload failed "${att.name}":`, (err as Error).message);
        }
      }
    }

    // Wait for note to finish
    await notePromise;

    // 14. Update email event to Completed (or NeedsHuman if attachments
    // were declared but unreadable — e.g. Gmail Drive smart-links).
    const driveFailureSummary = driveFailures.length > 0
      ? `Drive fetch failed for ${driveFailures.length} file(s): ${driveFailures.map(f => `${f.filename} (${f.error}) ${f.url}`).join(' | ')}`
      : '';
    if (ghostAttachments) {
      const reason = driveLinks.length > 0
        ? `All ${driveLinks.length} Gmail Drive smart-link(s) failed to download. ${driveFailureSummary}`
        : 'Attachments declared on email but none readable (likely Gmail Drive smart-links or referenceAttachment).';
      console.warn(`[inbound] Marking NeedsHuman for message ${messageId}: ${reason}`);
      await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
        processing_status: 'NeedsHuman',
        error_message: reason.slice(0, 1000),
      });
    } else if (driveFailures.length > 0 && driveFailures.some(f => f.error !== 'too_large')) {
      // Partial Drive success with non-too_large failures (permission / network /
      // bad_id) — these never produce a fallback PC, so the operator must still
      // intervene. DL-420 too_large rejects DO produce a metadata-only PC in AI
      // Review and shouldn't drag the email to NeedsHuman — they're surfaced via
      // the partial-failure counter instead.
      console.warn(`[inbound] Partial Drive failure for message ${messageId}: ${driveFailureSummary}`);
      await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
        processing_status: 'NeedsHuman',
        error_message: driveFailureSummary.slice(0, 1000),
      });
    } else {
      await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
        processing_status: 'Completed',
      });
    }
  } catch (err) {
    console.error('[inbound] Pipeline error:', (err as Error).message);

    // Update email event to Failed if we have one
    if (emailEventId) {
      try {
        await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
          processing_status: 'Failed',
          error_message: (err as Error).message,
        });
      } catch {
        // ignore update failure
      }
    }

    // Fire error alert
    logError(ctx, env, {
      endpoint: '/process-inbound-email',
      error: err,
      category: 'INTERNAL',
      details: `message_id=${messageId}`,
    });

    throw err;
  }
}
