/**
 * Types and constants for the WF05 inbound email processing pipeline.
 * Migrated from n8n workflow cIa23K8v1PrbDJqY (DL-203).
 */

import type { Env } from '../types';
import type { MSGraphClient } from '../ms-graph';
import type { AirtableClient, AirtableRecord } from '../airtable';

// ---------------------------------------------------------------------------
// Airtable table IDs
// ---------------------------------------------------------------------------

export const TABLES = {
  CLIENTS: 'tblFFttFScDRZ7Ah5',
  REPORTS: 'tbls7m3hmHC4hhQVy',
  DOCUMENTS: 'tblcwptR63skeODPn',
  EMAIL_EVENTS: 'tblJAPEcSJpzdEBcW',
  PENDING_CLASSIFICATIONS: 'tbloiSDN3rwRcl1ii',
} as const;

/** Mailbox that receives client emails */
export const MAILBOX = 'reports@moshe-atsits.co.il';

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

export interface InboundEmailRequest {
  message_id: string;
  change_type: string;
}

// ---------------------------------------------------------------------------
// Processing context (passed through the pipeline)
// ---------------------------------------------------------------------------

export interface ProcessingContext {
  env: Env;
  ctx: ExecutionContext;
  graph: MSGraphClient;
  airtable: AirtableClient;
  messageId: string;
}

// ---------------------------------------------------------------------------
// Email metadata (extracted from MS Graph email object)
// ---------------------------------------------------------------------------

export interface EmailMetadata {
  messageId: string;
  internetMessageId: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  receivedAt: string;
  bodyPreview: string;
  bodyText: string;
  bodyHtml: string;
  hasAttachments: boolean;
  isAutoReply: boolean;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface RawAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentBytes?: string; // base64
}

export interface AttachmentInfo {
  id: string;
  name: string;
  contentType: string;
  size: number;
  content: ArrayBuffer;
  sha256: string;
}

// ---------------------------------------------------------------------------
// Client identification
// ---------------------------------------------------------------------------

export type MatchMethod =
  | 'email_match'
  | 'forwarded_email'
  | 'sender_name'
  | 'ai_identification'
  | 'unidentified';

export interface ClientMatch {
  clientRecordId: string;
  clientName: string;
  clientId: string;
  email: string;
  matchMethod: MatchMethod;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ActiveReport {
  reportRecordId: string;
  reportKey: string;
  year: number;
  stage: string;
  clientName: string;
  filingType: string;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface AdditionalMatch {
  templateId: string;
  evidence: string;
  issuerName: string;
  confidence: number;
  matchedDocRecordId?: string | null;
  matchedDocName?: string | null;
  matchQuality?: string | null;
}

export interface ClassificationResult {
  templateId: string | null;
  confidence: number;
  reason: string;
  issuerName: string;
  matchedDocRecordId: string | null;
  matchedDocName: string | null;
  matchQuality: string | null;
  additionalMatches?: AdditionalMatch[];
  contractPeriod?: { startDate: string; endDate: string; coversFullYear: boolean } | null;
  /** DL-315: set when classifier ran against full filing-type catalog because client has no required_docs yet */
  preQuestionnaire?: boolean;
  /** DL-321: false when attachment is decorative, signature, or blank page — processor may short-circuit */
  isDocument?: boolean;
  /** DL-321: category when isDocument=false; 'not_applicable' when isDocument=true */
  nonDocumentReason?: 'decorative' | 'signature' | 'blank_page' | 'not_applicable';
}

// ---------------------------------------------------------------------------
// Allowed document extensions and content types
// ---------------------------------------------------------------------------

/** Extensions that are always processed regardless of size */
export const DOC_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods',
  '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.heic',
]);

/** Extensions to always skip */
export const SKIP_EXTENSIONS = new Set([
  '.gif', '.ico', '.bmp', '.html', '.xml', '.ics', '.vcf', '.svg',
]);

/** Extensions that MS Graph can convert to PDF via ?format=pdf */
export const OFFICE_CONVERTIBLE = new Set([
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.rtf', '.odt', '.ods', '.odp',
]);

/** Image extensions (upload as-is, no PDF conversion in Worker) */
export const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.heic',
]);

/** Archive formats we can extract */
export const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);

/** ZIP handled natively (lightweight); RAR/7z need archive-wasm */
export const ZIP_EXTENSIONS = new Set(['.zip']);
