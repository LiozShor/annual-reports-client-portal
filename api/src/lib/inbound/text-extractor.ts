// text-extractor.ts — Extract text from DOCX and XLSX files
// Uses only Web APIs (Uint8Array, DataView, TextDecoder, DecompressionStream)
// No Node.js Buffer — compatible with Cloudflare Workers

// ── Uint8Array helpers ─────────────────────────────────────────────

function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ── DEFLATE decompression (raw, for ZIP files) ─────────────────────

async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatArrays(...chunks);
}

// ── XML entity decoder ─────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── ZIP local-file-header walker ───────────────────────────────────

const ZIP_LOCAL_HEADER_SIG = 0x04034b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * Extract a single file from a ZIP archive by exact path.
 * Returns the file content as a UTF-8 string, or null if not found / error.
 */
async function extractFileFromZip(
  data: Uint8Array,
  innerPath: string,
): Promise<string | null> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder('utf-8');
  let offset = 0;

  while (offset < data.length - 30) {
    if (view.getUint32(offset, true) !== ZIP_LOCAL_HEADER_SIG) break;

    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(data.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;

    if (name === innerPath) {
      const raw = data.subarray(dataStart, dataStart + compSize);
      try {
        if (method === METHOD_STORED) {
          return decoder.decode(raw);
        }
        if (method === METHOD_DEFLATE) {
          const decompressed = await inflate(raw);
          return decoder.decode(decompressed);
        }
        // Unsupported compression method
        return null;
      } catch {
        return null;
      }
    }

    offset = dataStart + compSize;
  }

  return null;
}

/**
 * Extract all files from a ZIP archive whose path starts with a given prefix.
 * Returns array of { name, data } with raw binary data.
 */
export async function extractFilesFromZip(
  data: Uint8Array,
  pathPrefix: string,
): Promise<Array<{ name: string; data: Uint8Array }>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder('utf-8');
  const results: Array<{ name: string; data: Uint8Array }> = [];
  let offset = 0;

  while (offset < data.length - 30) {
    if (view.getUint32(offset, true) !== ZIP_LOCAL_HEADER_SIG) break;

    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(data.subarray(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;

    if (name.startsWith(pathPrefix)) {
      const raw = data.subarray(dataStart, dataStart + compSize);
      try {
        let fileData: Uint8Array;
        if (method === METHOD_STORED) {
          fileData = raw.slice(); // copy
        } else if (method === METHOD_DEFLATE) {
          fileData = await inflate(raw);
        } else {
          // Unsupported compression method — skip
          offset = dataStart + compSize;
          continue;
        }
        results.push({ name, data: fileData });
      } catch {
        // Skip files that fail to decompress
      }
    }

    offset = dataStart + compSize;
  }

  return results;
}

// ── DOCX text extraction ───────────────────────────────────────────

/**
 * Extract plain text from a DOCX file (Uint8Array).
 * Reads word/document.xml and extracts <w:t> tag content.
 */
export async function extractDocxText(content: Uint8Array): Promise<string> {
  try {
    const xml = await extractFileFromZip(content, 'word/document.xml');
    if (!xml) return '';

    // Extract text runs from <w:t> tags
    const matches = xml.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) ?? [];
    const parts = matches.map((m) => {
      const inner = m.replace(/<w:t(?:\s[^>]*)?>/g, '').replace(/<\/w:t>/g, '');
      return decodeXmlEntities(inner);
    });

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ── DOCX image extraction ──────────────────────────────────────────

const MEDIA_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

/**
 * Extract all embedded images from a DOCX file.
 * Returns array of { data: Uint8Array, mediaType: string }.
 */
export async function extractDocxImages(
  content: Uint8Array,
): Promise<Array<{ data: Uint8Array; mediaType: string }>> {
  try {
    const files = await extractFilesFromZip(content, 'word/media/');
    const results: Array<{ data: Uint8Array; mediaType: string }> = [];

    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const mediaType = MEDIA_MIME_MAP[ext];
      if (mediaType) {
        results.push({ data: file.data, mediaType });
      }
    }

    return results;
  } catch {
    return [];
  }
}

// ── XLSX text extraction ───────────────────────────────────────────

/**
 * Extract plain text from an XLSX file (Uint8Array).
 * Reads xl/sharedStrings.xml for string values, falls back to sheet1.xml.
 * Prepends sheet names from xl/workbook.xml.
 */
export async function extractXlsxText(content: Uint8Array): Promise<string> {
  try {
    const parts: string[] = [];

    // Extract sheet names from workbook
    const workbookXml = await extractFileFromZip(content, 'xl/workbook.xml');
    if (workbookXml) {
      const sheetMatches =
        workbookXml.match(/<sheet\s[^>]*name="([^"]*)"[^>]*\/>/g) ?? [];
      for (const m of sheetMatches) {
        const nameMatch = m.match(/name="([^"]*)"/);
        if (nameMatch) {
          parts.push(decodeXmlEntities(nameMatch[1]));
        }
      }
    }

    // Extract shared strings (most cell text lives here)
    const sharedStringsXml = await extractFileFromZip(
      content,
      'xl/sharedStrings.xml',
    );
    if (sharedStringsXml) {
      const tMatches =
        sharedStringsXml.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) ?? [];
      for (const m of tMatches) {
        const inner = m.replace(/<t(?:\s[^>]*)?>/g, '').replace(/<\/t>/g, '');
        const text = decodeXmlEntities(inner).trim();
        if (text) parts.push(text);
      }
    }

    // Fallback: also scan sheet1 for inline strings not in sharedStrings
    const sheet1Xml = await extractFileFromZip(
      content,
      'xl/worksheets/sheet1.xml',
    );
    if (sheet1Xml) {
      // Inline string cells <is><t>...</t></is>
      const inlineMatches =
        sheet1Xml.match(/<is>[\s\S]*?<\/is>/g) ?? [];
      for (const m of inlineMatches) {
        const tMatches2 = m.match(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g) ?? [];
        for (const t of tMatches2) {
          const inner = t.replace(/<t(?:\s[^>]*)?>/g, '').replace(/<\/t>/g, '');
          const text = decodeXmlEntities(inner).trim();
          if (text) parts.push(text);
        }
      }
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}
