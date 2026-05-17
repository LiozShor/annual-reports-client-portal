import type { RawAttachment, AttachmentInfo } from './types';
import { DOC_EXTENSIONS, SKIP_EXTENSIONS, OFFICE_CONVERTIBLE, ARCHIVE_EXTENSIONS, IMAGE_EXTENSIONS, MAILBOX } from './types';
import { DRIVE_ID, sanitizeFilename } from '../classification-helpers';
import type { MSGraphClient } from '../ms-graph';

/** OneDrive shared folder sharing token — resolves to the root folder for client documents */
const ONEDRIVE_SHARING_TOKEN = 'u!aHR0cHM6Ly9tb3NoZWF0c2l0cy1teS5zaGFyZXBvaW50LmNvbS86ZjovZy9wZXJzb25hbC9yZXBvcnRzX21vc2hlLWF0c2l0c19jb19pbC9JZ0NjSEVYU2pZSWpUcHlrdXJ3NnJvOENBV01WZ0xlaC1lR19oUUViMjlZeG5Fbz9lPWZUYzl5Qw';

export interface OneDriveRoot {
  driveId: string;
  rootFolderId: string;
}

export interface OneDriveUploadResult {
  webUrl: string;
  itemId: string;
  downloadUrl: string;
}

/** Extract lowercase extension including the dot */
export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx === -1) return '';
  return filename.slice(idx).toLowerCase();
}

/** Filter out skippable and tiny non-document attachments. */
export function filterValidAttachments(attachments: RawAttachment[]): RawAttachment[] {
  return attachments.filter((att) => {
    const ext = getFileExtension(att.name);
    if (SKIP_EXTENSIONS.has(ext)) return false;
    if (ARCHIVE_EXTENSIONS.has(ext)) return true;
    // Drop inline only when it's a small image — catches signature logos / tracking pixels.
    // iPhone Mail sends real PDFs with isInline=true (Content-Disposition: inline preview).
    // 50KB ceiling: Outlook-rendered signature logos are typically 10–40KB (observed ~30KB for office logo).
    if (att.isInline && IMAGE_EXTENSIONS.has(ext) && att.size < 50_000) return false;
    if (!DOC_EXTENSIONS.has(ext) && att.size < 1000) return false;
    return true;
  });
}

/** Compute SHA-256 hex digest of an ArrayBuffer */
export async function computeSha256(content: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', content);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Decode base64 string to ArrayBuffer */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

/** Fetch, filter, decode, and hash attachments for a given message */
export async function fetchAttachments(
  graph: MSGraphClient,
  messageId: string
): Promise<AttachmentInfo[]> {
  const response = await graph.get(
    `/users/${MAILBOX}/messages/${messageId}/attachments`
  );
  const raw: RawAttachment[] = response.value || [];
  const valid = filterValidAttachments(raw);

  // Diagnose unsupported attachment shapes (Gmail Drive smart-links arrive as
  // referenceAttachment with no contentBytes — silently dropped before this fix).
  const unsupported = raw.filter((a: any) => {
    const t = a['@odata.type'] || '';
    return t.includes('referenceAttachment') || t.includes('itemAttachment');
  });
  if (unsupported.length > 0) {
    console.warn(
      `[inbound] ${unsupported.length} unreadable attachment(s) on message ${messageId} ` +
      `(types: ${unsupported.map((a: any) => a['@odata.type']).join(', ')}; ` +
      `names: ${unsupported.map((a: any) => a.name).join(', ')})`
    );
  }

  const results: AttachmentInfo[] = [];
  for (const att of valid) {
    if (!att.contentBytes) continue;
    const content = base64ToArrayBuffer(att.contentBytes);
    const sha256 = await computeSha256(content);
    results.push({
      id: att.id,
      name: att.name,
      contentType: att.contentType,
      size: att.size,
      content,
      sha256,
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// DL-367: Gmail Drive smart-link support.
//
// Gmail's "Insert from Drive" embeds inline `gmail_drive_chip` HTML cards in
// the message body — Outlook renders them as attachment cards but they are NOT
// real MIME attachments. `hasAttachments=false`, no Graph attachment list.
// We parse the file IDs from body HTML and fetch the binaries from Drive's
// anonymous direct-download endpoint (post-May-2024 endpoint with `confirm=t`).
// ---------------------------------------------------------------------------

/** Drive file ID format: 20+ chars of `[A-Za-z0-9_-]`. */
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;

/** Allowed Drive content-types — anything else means HTML "you need access" page. */
const DRIVE_OK_CONTENT_TYPES = [
  'application/pdf',
  'application/octet-stream',
  'image/',
  'application/vnd.openxmlformats-officedocument.',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.',
];

const DRIVE_DEFAULT_MAX_BYTES = 52_428_800; // 50 MB (DL-414)

export interface ParsedDriveLink {
  fileId: string;
  filename: string;
}

/**
 * Parse Gmail Drive chips and bare Drive URLs from email body HTML.
 *
 * Strategy 1 (preferred): match `gmail_drive_chip` divs to extract `{fileId, filename}`.
 * Strategy 2 (fallback): match any `drive.google.com` / `docs.google.com` URL with file ID.
 * Dedup by fileId — chip filename takes precedence over URL-derived names.
 */
export function parseDriveLinks(bodyHtml: string): ParsedDriveLink[] {
  const found = new Map<string, string>(); // fileId → filename

  if (!bodyHtml) return [];

  // Strategy 1: Gmail Drive chip blocks.
  // Pattern: chip div has `class="...gmail_drive_chip..."` and `id="{fileId}"`
  // (id and class can appear in any order). The filename is carried as a
  // `title="..."` attribute on a child element — Gmail puts it on an inner
  // `<div>` (not an `<a>`), so we match any tag with a title attribute within
  // the next ~4 KB of HTML.
  const chipReA = /<div\b[^>]*class="[^"]*gmail_drive_chip[^"]*"[^>]*\bid="([A-Za-z0-9_-]{20,})"[\s\S]{0,4000}?\btitle="([^"]+)"/gi;
  const chipReB = /<div\b[^>]*\bid="([A-Za-z0-9_-]{20,})"[^>]*class="[^"]*gmail_drive_chip[^"]*"[\s\S]{0,4000}?\btitle="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  for (const re of [chipReA, chipReB]) {
    while ((m = re.exec(bodyHtml)) !== null) {
      const id = m[1];
      const name = m[2];
      if (DRIVE_ID_RE.test(id) && !found.has(id)) {
        found.set(id, name);
      }
    }
  }

  // Strategy 2: bare Drive URLs anywhere in HTML.
  // file/d/{id}/, open?id={id}, uc?...id={id}
  const urlRe = /https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|open\?id=|uc\?[^"'\s]*?id=)([A-Za-z0-9_-]{20,})/gi;
  while ((m = urlRe.exec(bodyHtml)) !== null) {
    const id = m[1];
    if (DRIVE_ID_RE.test(id) && !found.has(id)) {
      found.set(id, `drive_${id}.pdf`); // best-effort default; classifier will correct via Content-Type
    }
  }

  return Array.from(found.entries()).map(([fileId, filename]) => ({ fileId, filename }));
}

export type DriveFetchResult =
  | { ok: true; attachment: AttachmentInfo }
  // DL-420 Phase 3: when `too_large` fires, we still know the parsed filename
  // (from Content-Disposition) and the declared size (from Content-Length).
  // Pass both back so the synthetic stub + AI-Review badge can show the real
  // file name + size instead of placeholders.
  | { ok: false; error: 'too_large'; realFilename?: string; sizeBytes?: number }
  | { ok: false; error: string };

/**
 * Fetch a single Drive file via the anonymous public download endpoint.
 * Returns an AttachmentInfo on success or {error} on failure (caller decides
 * whether to flag NeedsHuman or continue with partial results).
 */
export async function fetchDriveAttachment(
  link: ParsedDriveLink,
  maxBytes: number = DRIVE_DEFAULT_MAX_BYTES,
): Promise<DriveFetchResult> {
  const { fileId, filename } = link;
  if (!DRIVE_ID_RE.test(fileId)) {
    return { ok: false, error: `bad_id:${fileId}` };
  }

  const url = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&authuser=0&confirm=t`;

  let resp: Response;
  try {
    resp = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    return { ok: false, error: `fetch_threw:${(err as Error).message}` };
  }

  if (!resp.ok) {
    return { ok: false, error: `http_${resp.status}` };
  }

  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  const ctOk = DRIVE_OK_CONTENT_TYPES.some(p => ct.startsWith(p));
  if (!ctOk) {
    // Drive returns text/html with the "you need access" page when the file
    // isn't shared "anyone with link" — this is the cleanest permission probe.
    return { ok: false, error: `not_binary_${ct || 'unknown'}` };
  }

  // DL-420 follow-up: parse the real filename from Content-Disposition so the
  // attachment carries `U9744004.2025.tax.zip` rather than the
  // `drive_{fileId}.pdf` placeholder set by parseDriveLinks. Without this fix
  // ZIPs from Gmail Drive smart-links land in OneDrive named `*.pdf`, and
  // archive-expander's `getFileExtension` lookup skips them entirely.
  const cd = resp.headers.get('content-disposition') || '';
  // Prefer RFC 5987 `filename*=UTF-8''...` (URL-encoded, supports Hebrew); fall
  // back to plain `filename="..."`.
  const parsedFilename = (() => {
    const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/i.exec(cd);
    if (star) {
      try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
    }
    const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(cd);
    if (plain) return (plain[1] ?? plain[2] ?? '').trim();
    return '';
  })();
  const realFilename = parsedFilename || filename;

  // DL-420 Phase 3: Drive sends Content-Length on the download response. Parse
  // it so the too_large branch can return the real declared size — drives the
  // "קובץ גדול מדי (62 MB)" badge in AI Review.
  const cl = parseInt(resp.headers.get('content-length') || '0', 10);
  const declaredSize = Number.isFinite(cl) && cl > 0 ? cl : 0;

  // Stream-read into chunks with hard byte cap.
  const reader = resp.body?.getReader();
  if (!reader) {
    return { ok: false, error: 'no_response_body' };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* noop */ }
      return {
        ok: false,
        error: 'too_large',
        realFilename,
        sizeBytes: declaredSize || total,
      };
    }
    chunks.push(value);
  }

  // Concatenate chunks
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const content = merged.buffer as ArrayBuffer;
  const sha256 = await computeSha256(content);

  return {
    ok: true,
    attachment: {
      id: `drive:${fileId}`,
      name: realFilename,
      contentType: ct.split(';')[0].trim() || 'application/octet-stream',
      size: total,
      content,
      sha256,
    },
  };
}

/** Strip Gmail Drive chip div blocks from body HTML so they don't leak into LLM input. */
export function stripDriveChipsFromHtml(bodyHtml: string): string {
  if (!bodyHtml) return bodyHtml;
  // Greedy-but-bounded: match a chip div and everything up to its closing </div>
  // pair. Gmail nests 3-4 divs deep inside; bound to ~4 KB per chip to avoid
  // catastrophic backtracking.
  return bodyHtml.replace(
    /<div\b[^>]*class="[^"]*gmail_drive_chip[^"]*"[\s\S]{0,4000}?<\/div>\s*<\/div>\s*<\/div>/gi,
    '',
  );
}

/** Diagnostic: returns true if the message claims attachments but none were readable. */
export async function hasUnreadableAttachments(
  graph: MSGraphClient,
  messageId: string
): Promise<{ unreadable: boolean; types: string[]; names: string[] }> {
  const response = await graph.get(
    `/users/${MAILBOX}/messages/${messageId}/attachments?$select=name,contentType,size,isInline`
  );
  const raw: any[] = response.value || [];
  const dropped = raw.filter((a) => !a.contentBytes && !a['@odata.type']?.includes('fileAttachment'));
  return {
    unreadable: dropped.length > 0,
    types: dropped.map((a) => a['@odata.type'] || 'unknown'),
    names: dropped.map((a) => a.name || ''),
  };
}

/** Resolve the OneDrive shared folder root (drive ID + folder item ID) */
export async function resolveOneDriveRoot(graph: MSGraphClient): Promise<OneDriveRoot> {
  const result = await graph.get(`/shares/${ONEDRIVE_SHARING_TOKEN}/driveItem`);
  return {
    driveId: result.parentReference?.driveId || DRIVE_ID,
    rootFolderId: result.id || '',
  };
}

/** Filing type → OneDrive folder name */
export const FILING_TYPE_FOLDER: Record<string, string> = {
  annual_report: 'דוח שנתי',
  capital_statement: 'הצהרת הון',
};

// DL-419: above this size we use createUploadSession + chunked PUT instead of
// the simple `PUT /content` path. CF Workers' fetch() body buffer + a 32 MB
// ArrayBuffer body produced ~64 MB peak per PUT and OOM'd inbound on
// 2026-05-17. Chunked upload keeps peak ≈ chunk size + a few MB of HTTP
// overhead. Threshold of 5 MB matches the >5 MB classifier-content threshold
// in document-classifier.ts so they move together.
const UPLOAD_SESSION_THRESHOLD = 5 * 1024 * 1024;
// Fragment size MUST be a multiple of 320 KiB (327,680) per MS Graph spec;
// non-multiples cause the LAST chunk to fail. 5 MiB = 16 × 320 KiB.
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024;

/** Upload a file to the client's OneDrive folder */
export async function uploadToOneDrive(
  graph: MSGraphClient,
  root: OneDriveRoot,
  clientName: string,
  year: string,
  filename: string,
  content: ArrayBuffer,
  filingType?: string,
): Promise<OneDriveUploadResult> {
  const safeName = sanitizeFilename(filename);
  const filingFolder = filingType ? FILING_TYPE_FOLDER[filingType] || FILING_TYPE_FOLDER.annual_report : FILING_TYPE_FOLDER.annual_report;

  // DL-419: route large files through createUploadSession.
  if (content.byteLength > UPLOAD_SESSION_THRESHOLD) {
    return uploadLargeFileToOneDrive(graph, root, clientName, year, safeName, filingFolder, content);
  }

  const path = `/drives/${root.driveId}/items/${root.rootFolderId}:/${encodeURIComponent(clientName)}/${year}/${encodeURIComponent(filingFolder)}/${encodeURIComponent(safeName)}:/content?@microsoft.graph.conflictBehavior=rename`;
  const response = await graph.putBinary(path, content);
  return {
    webUrl: response.webUrl,
    itemId: response.id,
    downloadUrl: response['@microsoft.graph.downloadUrl'],
  };
}

/**
 * DL-419: chunked upload for files larger than UPLOAD_SESSION_THRESHOLD.
 *
 * Sequence:
 *   1. POST createUploadSession → uploadUrl (this is an unauthenticated short-lived URL).
 *   2. For each 5 MiB slice: PUT with Content-Range header.
 *   3. Final chunk's response carries the DriveItem (id, webUrl, downloadUrl).
 *
 * The uploadUrl returned by createUploadSession is a pre-authenticated URL —
 * we hit it directly with `fetch()`, NOT through graph.putBinary (which would
 * attach a Bearer token that the upload endpoint rejects).
 */
async function uploadLargeFileToOneDrive(
  graph: MSGraphClient,
  root: OneDriveRoot,
  clientName: string,
  year: string,
  safeName: string,
  filingFolder: string,
  content: ArrayBuffer,
): Promise<OneDriveUploadResult> {
  const createPath = `/drives/${root.driveId}/items/${root.rootFolderId}:/${encodeURIComponent(clientName)}/${year}/${encodeURIComponent(filingFolder)}/${encodeURIComponent(safeName)}:/createUploadSession`;
  const session = await graph.post(createPath, {
    item: { '@microsoft.graph.conflictBehavior': 'rename', name: safeName },
  });
  const uploadUrl: string | undefined = session?.uploadUrl;
  if (!uploadUrl) {
    throw new Error('createUploadSession returned no uploadUrl');
  }

  const total = content.byteLength;
  const bytes = new Uint8Array(content);
  let lastResponse: { id?: string; webUrl?: string; '@microsoft.graph.downloadUrl'?: string } | null = null;

  console.log(`[inbound][DL-419] Chunked upload start ${safeName} ${total} bytes (${Math.ceil(total / UPLOAD_CHUNK_SIZE)} chunks of ${UPLOAD_CHUNK_SIZE})`);

  for (let start = 0; start < total; start += UPLOAD_CHUNK_SIZE) {
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, total) - 1; // inclusive
    const chunk = bytes.subarray(start, end + 1);
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.byteLength),
        'Content-Range': `bytes ${start}-${end}/${total}`,
      },
      body: chunk,
    });
    if (res.status === 200 || res.status === 201) {
      lastResponse = await res.json();
    } else if (res.status === 202) {
      // Accepted — more chunks expected. Drain body to free the connection.
      await res.arrayBuffer();
    } else {
      const errBody = await res.text().catch(() => '');
      throw new Error(`[DL-419] Upload chunk ${start}-${end}/${total} failed: ${res.status} ${errBody.slice(0, 300)}`);
    }
  }

  if (!lastResponse?.id) {
    throw new Error('[DL-419] Upload session completed without DriveItem in final response');
  }
  console.log(`[inbound][DL-419] Chunked upload done ${safeName} itemId=${lastResponse.id}`);
  return {
    webUrl: lastResponse.webUrl ?? '',
    itemId: lastResponse.id,
    downloadUrl: lastResponse['@microsoft.graph.downloadUrl'] ?? '',
  };
}

/** Create-or-get a single folder under a parent. Returns the folder's item ID. */
async function ensureFolder(
  graph: MSGraphClient,
  driveId: string,
  parentId: string,
  name: string,
): Promise<string> {
  try {
    const created = await graph.post(`/drives/${driveId}/items/${parentId}/children`, {
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    });
    return created?.id;
  } catch {
    // Folder likely exists — get it by path
    const existing = await graph.get(
      `/drives/${driveId}/items/${parentId}:/${encodeURIComponent(name)}:`
    );
    return existing?.id;
  }
}

export interface FolderStructureResult {
  clientFolderId: string;
  yearFolderId: string;
  filingFolderId: string;
}

/** Pre-create the full OneDrive folder hierarchy for a client report. */
export async function createClientFolderStructure(
  graph: MSGraphClient,
  root: OneDriveRoot,
  clientName: string,
  year: string,
  filingType: string,
): Promise<FolderStructureResult> {
  const filingFolder = FILING_TYPE_FOLDER[filingType] || FILING_TYPE_FOLDER.annual_report;
  const clientFolderId = await ensureFolder(graph, root.driveId, root.rootFolderId, clientName);
  const yearFolderId = await ensureFolder(graph, root.driveId, clientFolderId, year);
  const filingFolderId = await ensureFolder(graph, root.driveId, yearFolderId, filingFolder);
  return { clientFolderId, yearFolderId, filingFolderId };
}

/**
 * Convert an Office document to PDF via Graph API.
 * TODO: Needs MSGraphClient enhancement for binary GET responses.
 * Currently returns null.
 */
export async function convertOfficeToPdf(
  graph: MSGraphClient,
  driveItemId: string
): Promise<{ pdfContent: ArrayBuffer; pdfFilename: string } | null> {
  // Graph endpoint: GET /drives/{driveId}/items/{itemId}/content?format=pdf
  // Returns binary PDF content directly, but MSGraphClient.get() parses as JSON.
  // Requires a raw binary fetch method on MSGraphClient.
  return null;
}
