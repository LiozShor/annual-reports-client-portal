/**
 * Archive extraction for inbound email attachments (DL-260).
 *
 * All formats (ZIP/RAR/7z) use archive-wasm (libarchive WASM, lazy-loaded).
 * The lightweight ZIP parser in text-extractor.ts failed on ZIPs with data
 * descriptors or non-deflate compression (common in tax software output).
 *
 * Security guards: max file count, max decompressed size, path traversal,
 * no recursive extraction of nested archives.
 */

import type { AttachmentInfo } from './types';
import { ARCHIVE_EXTENSIONS } from './types';
import { getFileExtension, computeSha256 } from './attachment-utils';

// ── Limits (Workers 128MB memory — raw archive + decompressed must fit) ──

const MAX_FILES_PER_ARCHIVE = 50;
const MAX_TOTAL_DECOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// ── MIME map for extracted files ──

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
};

function guessMime(filename: string): string {
  return EXT_TO_MIME[getFileExtension(filename)] ?? 'application/octet-stream';
}

// ── Result types ──

export interface ArchiveLogEntry {
  archive: string;
  action: 'extracted' | 'skipped_traversal' | 'skipped_nested' | 'skipped_oversize' | 'limit_reached' | 'extract_failed';
  file?: string;
  reason?: string;
}

export interface ArchiveExpansionResult {
  /** Expanded attachment list: non-archives pass through, archives replaced by extracted files */
  attachments: AttachmentInfo[];
  /** Archives that could not be extracted (encrypted, corrupted) — kept as-is */
  failedArchives: string[];
  /** Map from extracted filename → source archive name */
  sourceArchiveMap: Map<string, string>;
  /** Structured log entries */
  log: ArchiveLogEntry[];
}

// ── Path traversal guard ──

function isSafePath(entryPath: string): boolean {
  // Reject paths with directory traversal
  if (entryPath.includes('..')) return false;
  // Reject absolute paths
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return false;
  return true;
}

/** Extract the filename portion from an archive entry path */
function entryBasename(entryPath: string): string {
  const parts = entryPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || entryPath;
}

// ── Archive extraction via archive-wasm (libarchive WASM, lazy-loaded) ──
// All formats (ZIP/RAR/7z) go through libarchive for robust handling of
// data descriptors, all compression methods, ZIP64, and Unicode filenames.
// The lightweight ZIP parser in text-extractor.ts is kept for DOCX/XLSX only.

// Cached extract function — module is only loaded once
let _cachedExtract: ((data: Uint8Array) => Iterable<{ type: string | null; path: string | null; data: ArrayBuffer | null }>) | null = null;

/**
 * Load archive-wasm with an environment trick.
 *
 * Problem: nodejs_compat exposes `process.versions.node`, so Emscripten's
 * environment detection picks NODE and tries fs.readFileSync() for the WASM
 * binary — which doesn't exist in Workers.
 *
 * Fix: temporarily hide `process` and expose `WorkerGlobalScope` before the
 * dynamic import, forcing Emscripten down the WORKER path which uses
 * fetch() + WebAssembly.instantiateStreaming (both available in Workers).
 * Wrangler's esbuild handles `new URL('libarchive.wasm', import.meta.url)`
 * by bundling the WASM and rewriting the URL reference.
 */
async function loadArchiveWasm() {
  if (_cachedExtract) return _cachedExtract;

  const g = globalThis as Record<string, unknown>;
  const savedProcess = g.process;
  const hadWorkerScope = 'WorkerGlobalScope' in g;
  const savedLocation = g.location;

  // Pre-import the WASM binary via Wrangler's native .wasm support.
  // This gives a pre-compiled WebAssembly.Module — no fetch/fs needed.
  const wasmModule: WebAssembly.Module = (await import(
    // @ts-expect-error — Wrangler handles .wasm imports natively
    'archive-wasm/src/wasm/libarchive.wasm'
  )).default;

  // Intercept WebAssembly.instantiateStreaming so Emscripten uses our
  // pre-compiled module instead of trying to fetch() a URL that doesn't exist.
  const wa = WebAssembly as unknown as Record<string, unknown>;
  const origStreaming = wa.instantiateStreaming;
  wa.instantiateStreaming = async (_resp: unknown, imports: WebAssembly.Imports) => {
    const instance = await WebAssembly.instantiate(wasmModule, imports);
    return { module: wasmModule, instance };
  };

  // Patch URL constructor: Emscripten calls new URL('libarchive.wasm', import.meta.url)
  // but import.meta.url isn't a valid URL in Workers. Provide a fallback base.
  const OrigURL = URL;
  g.URL = class PatchedURL extends OrigURL {
    constructor(url: string | URL, base?: string | URL) {
      try {
        super(url, base);
      } catch {
        super(url as string, 'https://wasm.local/');
      }
    }
  };

  // FinalizationRegistry not available in Workers — no-op polyfill is safe
  // (memory cleanup happens when the request ends anyway)
  if (!g.FinalizationRegistry) {
    g.FinalizationRegistry = class { register() {} unregister() { return false; } };
  }

  try {
    // Hide process → Emscripten skips NODE path
    Object.defineProperty(g, 'process', {
      value: undefined, configurable: true, writable: true,
    });
    // Ensure WORKER path is taken (not SHELL which throws)
    if (!hadWorkerScope) {
      g.WorkerGlobalScope = class {};
    }
    // Emscripten WORKER path reads self.location.href for script directory
    if (!g.location) {
      g.location = { href: '' };
    }

    const mod = await import('archive-wasm');
    _cachedExtract = mod.extract;
  } finally {
    // Restore everything
    g.URL = OrigURL;
    wa.instantiateStreaming = origStreaming;
    Object.defineProperty(g, 'process', {
      value: savedProcess, configurable: true, writable: true,
    });
    if (!hadWorkerScope) {
      delete g.WorkerGlobalScope;
    }
    g.location = savedLocation;
  }

  return _cachedExtract!;
}

async function extractWithWasm(
  data: Uint8Array,
  archiveName: string,
  log: ArchiveLogEntry[],
): Promise<Array<{ name: string; data: Uint8Array }>> {
  const extract = await loadArchiveWasm();

  const safe: Array<{ name: string; data: Uint8Array }> = [];
  let totalBytes = 0;

  for (const entry of extract(data)) {
    // Skip non-files (directories, symlinks, etc.)
    if (entry.type !== 'FILE' || !entry.data) continue;

    const entryPath: string = entry.path ?? '';
    if (!isSafePath(entryPath)) {
      log.push({ archive: archiveName, action: 'skipped_traversal', file: entryPath });
      continue;
    }
    // Nested archives pass through as regular files (no recursive extraction)
    const entryData = new Uint8Array(entry.data as ArrayBuffer);
    if (entryData.byteLength > MAX_SINGLE_FILE_BYTES) {
      log.push({ archive: archiveName, action: 'skipped_oversize', file: entryPath, reason: `${(entryData.byteLength / 1024 / 1024).toFixed(1)}MB > ${MAX_SINGLE_FILE_BYTES / 1024 / 1024}MB limit` });
      continue;
    }
    totalBytes += entryData.byteLength;
    if (totalBytes > MAX_TOTAL_DECOMPRESSED_BYTES) {
      log.push({ archive: archiveName, action: 'limit_reached', reason: `total decompressed exceeds ${MAX_TOTAL_DECOMPRESSED_BYTES / 1024 / 1024}MB` });
      break;
    }
    if (safe.length >= MAX_FILES_PER_ARCHIVE) {
      log.push({ archive: archiveName, action: 'limit_reached', reason: `>${MAX_FILES_PER_ARCHIVE} files` });
      break;
    }
    safe.push({ name: entryPath, data: entryData });
  }

  return safe;
}

// ── Main entry point ──

/**
 * Expand archive attachments into individual files.
 * Non-archive attachments pass through unchanged.
 * Failed archives are kept as-is in the output.
 */
const MAX_EXTRACTION_DEPTH = 3;

export async function expandArchiveAttachments(
  attachments: AttachmentInfo[],
): Promise<ArchiveExpansionResult> {
  const result: ArchiveExpansionResult = {
    attachments: [],
    failedArchives: [],
    sourceArchiveMap: new Map(),
    log: [],
  };

  // Process in rounds — each round may produce new archives to extract
  let pending = attachments;

  for (let depth = 0; depth < MAX_EXTRACTION_DEPTH; depth++) {
    const nextRound: AttachmentInfo[] = [];

    for (const att of pending) {
      const ext = getFileExtension(att.name);

      if (!ARCHIVE_EXTENSIONS.has(ext)) {
        result.attachments.push(att);
        continue;
      }

      console.log(`[archive] Extracting ${att.name} (${(att.size / 1024).toFixed(0)} KB, format: ${ext}, depth: ${depth})`);

      let extracted: Array<{ name: string; data: Uint8Array }>;
      try {
        const data = new Uint8Array(att.content);
        extracted = await extractWithWasm(data, att.name, result.log);
      } catch (err) {
        console.error(`[archive] Extraction failed for "${att.name}":`, (err as Error).message);
        result.log.push({ archive: att.name, action: 'extract_failed', reason: (err as Error).message });
        result.failedArchives.push(att.name);
        result.attachments.push(att);
        continue;
      }

      if (extracted.length === 0) {
        console.log(`[archive] No extractable files in "${att.name}" — keeping raw`);
        result.failedArchives.push(att.name);
        result.attachments.push(att);
        continue;
      }

      console.log(`[archive] Extracted ${extracted.length} file(s) from "${att.name}"`);

      // Build AttachmentInfo for each extracted file
      for (const entry of extracted) {
        const basename = entryBasename(entry.name);
        const content = entry.data.buffer.slice(
          entry.data.byteOffset,
          entry.data.byteOffset + entry.data.byteLength,
        ) as ArrayBuffer;
        const sha256 = await computeSha256(content);

        // Track provenance to the outermost archive
        const rootArchive = result.sourceArchiveMap.get(att.name) ?? att.name;

        const synth: AttachmentInfo = {
          id: `${att.id}__${basename}`,
          name: basename,
          contentType: guessMime(basename),
          size: entry.data.byteLength,
          content,
          sha256,
        };

        result.sourceArchiveMap.set(basename, rootArchive);
        result.log.push({ archive: att.name, action: 'extracted', file: basename });

        // If it's an archive itself, queue for next round
        if (ARCHIVE_EXTENSIONS.has(getFileExtension(basename))) {
          nextRound.push(synth);
        } else {
          result.attachments.push(synth);
        }
      }
    }

    pending = nextRound;
    if (pending.length === 0) break;
    console.log(`[archive] Depth ${depth}: ${pending.length} nested archive(s) queued for extraction`);
  }

  // Any archives still unextracted after max depth — pass through as-is
  if (pending.some(a => ARCHIVE_EXTENSIONS.has(getFileExtension(a.name)))) {
    for (const att of pending) {
      if (ARCHIVE_EXTENSIONS.has(getFileExtension(att.name))) {
        console.log(`[archive] Max depth reached — passing through ${att.name} as-is`);
        result.attachments.push(att);
      }
    }
  }

  return result;
}
