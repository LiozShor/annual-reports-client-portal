import { PDFDocument } from 'pdf-lib';

/**
 * Split a PDF into multiple PDFs based on page groups.
 * @param pdfBytes - Source PDF as ArrayBuffer
 * @param pageGroups - Array of 1-based page number arrays, one per output document.
 *   Example: [[1,2],[3],[4,5]] → 3 output PDFs.
 * @returns Array of Uint8Array, one per group, in the same order as pageGroups.
 */
export async function splitPdf(pdfBytes: ArrayBuffer, pageGroups: number[][]): Promise<Uint8Array[]> {
  if (!pageGroups || pageGroups.length === 0) {
    throw new Error('splitPdf: pageGroups must be a non-empty array');
  }

  const source = await PDFDocument.load(pdfBytes);
  const totalPages = source.getPageCount();

  const results: Uint8Array[] = [];

  for (let i = 0; i < pageGroups.length; i++) {
    const group = pageGroups[i];

    if (!group || group.length === 0) {
      throw new Error(`splitPdf: pageGroups[${i}] is empty`);
    }

    // Validate and convert 1-based → 0-based
    const indices = group.map((pageNum, j) => {
      if (pageNum < 1 || pageNum > totalPages) {
        throw new Error(
          `splitPdf: pageGroups[${i}][${j}] = ${pageNum} is out of range (PDF has ${totalPages} page(s))`
        );
      }
      return pageNum - 1;
    });

    const doc = await PDFDocument.create();
    const pages = await doc.copyPages(source, indices);
    pages.forEach(p => doc.addPage(p));

    results.push(await doc.save());
  }

  return results;
}

/**
 * Return the total page count of a PDF without extracting any pages.
 */
export async function getPdfPageCount(pdfBytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}
