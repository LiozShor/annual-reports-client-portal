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
import { fetchAttachments, uploadToOneDrive, resolveOneDriveRoot, getFileExtension, type OneDriveRoot } from './attachment-utils';
import { identifyClient } from './client-identifier';
import { classifyAttachment, checkFileHashDuplicate, TEMPLATE_TITLES } from './document-classifier';
import { resolveOneDriveFilename } from '../classification-helpers';
import { buildTemplateMap } from '../doc-builder';
import { getCachedOrFetch } from '../cache';
import { getPdfPageCount } from '../pdf-split';
import { imageToPdf } from './image-to-pdf';
import { expandArchiveAttachments } from './archive-expander';

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
  const bodyHtml = email.body?.content ?? '';
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
    logSecurity(pCtx.ctx, pCtx.airtable, {
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

    // Call LLM with tool_use for structured extraction (DL-262)
    const systemPrompt = `You are a CPA office assistant at an Israeli accounting firm. Parse a client email for an internal timeline.

Rules:
- Extract ONLY the new content written by the sender — ignore any quoted previous replies, forwarding headers, or email signatures that may remain
- Write the summary as ONE Hebrew sentence, maximum 15 words
- Focus on: what the client wants/needs, any urgency, documents or forms mentioned
- Always summarize in Hebrew, even if the email is in English
- clean_text should contain only the client's own words, in the original language
- Set skip=true if the email has no meaningful client communication (only attachments, auto-replies, delivery receipts, signature-only, or forwarded without new text)`;

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
        if (toolBlock.input.skip) {
          logSkip('llm_skip');
          return;
        }
        summary = String(toolBlock.input.summary || '');
        cleanText = String(toolBlock.input.clean_text || '');
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

  // Step 8: Create pending classification record (all fields matching n8n)
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
    ai_reason: classification?.reason ?? '',
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
    matched_doc_name: classification?.matchedDocName ?? null,
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

  await pCtx.airtable.createRecords(TABLES.PENDING_CLASSIFICATIONS, [
    { fields: classFields },
  ]);

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

    // 7. Identify client
    const clientMatch = await identifyClient(pCtx, metadata, attachments.map(a => a.name));

    // Update email event with match method (only fields that exist in the table)
    await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
      match_method: clientMatch.matchMethod,
    });

    // 8. Handle unidentified client
    if (clientMatch.matchMethod === 'unidentified') {
      const unidentifiedRoot = await resolveOneDriveRoot(graph);
      // Upload attachments to unidentified folder if any
      for (const att of attachments) {
        try {
          await uploadToOneDrive(
            graph,
            unidentifiedRoot,
            'לקוח לא מזוהה',
            String(new Date().getFullYear()),
            att.name,
            att.content,
          );
        } catch (err) {
          console.error(`[inbound] Upload failed for unidentified: ${(err as Error).message}`);
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
      for (let i = 0; i < attachments.length; i++) {
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
          console.error(
            `[inbound] Attachment "${attachments[i].name}" failed:`,
            (err as Error).message,
          );
          // Continue with next attachment
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

    // 14. Update email event to Completed
    await airtable.updateRecord(TABLES.EMAIL_EVENTS, emailEventId, {
      processing_status: 'Completed',
    });
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
