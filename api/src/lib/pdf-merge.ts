import { PDFDocument } from 'pdf-lib';

/**
 * Merge N PDFs into one in the order provided.
 * @param buffers Array of PDFs as ArrayBuffer. Must not be empty.
 * @returns Merged PDF as Uint8Array.
 * @throws Error if buffers array is empty.
 */
export async function mergePdfsN(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  if (buffers.length === 0) {
    throw new Error('mergePdfsN: buffers array is empty');
  }

  const merged = await PDFDocument.create();

  for (const buffer of buffers) {
    const doc = await PDFDocument.load(buffer);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }

  return merged.save();
}

/**
 * Merge two PDFs into one. Pages from pdfA come first, then pdfB.
 * Caller is responsible for ordering (e.g., chronologically).
 * @deprecated Use mergePdfsN instead.
 */
export async function mergePdfs(pdfA: ArrayBuffer, pdfB: ArrayBuffer): Promise<Uint8Array> {
  return mergePdfsN([pdfA, pdfB]);
}
