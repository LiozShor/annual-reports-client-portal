import { PDFDocument } from 'pdf-lib';

/**
 * Merge two PDFs into one. Pages from pdfA come first, then pdfB.
 * Caller is responsible for ordering (e.g., chronologically).
 */
export async function mergePdfs(pdfA: ArrayBuffer, pdfB: ArrayBuffer): Promise<Uint8Array> {
  const merged = await PDFDocument.create();

  const docA = await PDFDocument.load(pdfA);
  const pagesA = await merged.copyPages(docA, docA.getPageIndices());
  pagesA.forEach(p => merged.addPage(p));

  const docB = await PDFDocument.load(pdfB);
  const pagesB = await merged.copyPages(docB, docB.getPageIndices());
  pagesB.forEach(p => merged.addPage(p));

  return merged.save();
}
