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
    if (att.isInline && IMAGE_EXTENSIONS.has(ext) && att.size < 20_000) return false;
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
  const path = `/drives/${root.driveId}/items/${root.rootFolderId}:/${encodeURIComponent(clientName)}/${year}/${encodeURIComponent(filingFolder)}/${encodeURIComponent(safeName)}:/content?@microsoft.graph.conflictBehavior=rename`;
  const response = await graph.putBinary(path, content);
  return {
    webUrl: response.webUrl,
    itemId: response.id,
    downloadUrl: response['@microsoft.graph.downloadUrl'],
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
