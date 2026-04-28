/**
 * pdf-annotations.ts — DL-372
 *
 * Adds/removes a /Annot Text (sticky-note) on page 1 of a PDF using pdf-lib
 * low-level API. The note is tagged with T="moshe-atsits-internal-note" so
 * re-saving replaces rather than appends.
 */

import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict, PDFNumber, PDFHexString } from 'pdf-lib';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

const ANNOT_TITLE = 'moshe-atsits-internal-note';

function cornerCoords(corner: Corner, pageWidth: number, pageHeight: number): [number, number] {
  const margin = 20;
  const iconSize = 24;
  switch (corner) {
    case 'tl': return [margin, pageHeight - margin - iconSize];
    case 'tr': return [pageWidth - margin - iconSize, pageHeight - margin - iconSize];
    case 'bl': return [margin, margin];
    case 'br': return [pageWidth - margin - iconSize, margin];
  }
}

/** Returns modified PDF bytes with a sticky-note annotation on page 1. */
export async function addStickyNote(
  pdfBytes: ArrayBuffer,
  opts: { text: string; corner: Corner }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const page = doc.getPage(0);
  const { width, height } = page.getSize();
  const [x, y] = cornerCoords(opts.corner, width, height);

  const pageNode = page.node;
  const context = doc.context;

  // Strip existing internal notes
  const existingAnnotsRef = pageNode.get(PDFName.of('Annots'));
  const existingAnnots: PDFDict[] = [];
  if (existingAnnotsRef instanceof PDFArray) {
    for (let i = 0; i < existingAnnotsRef.size(); i++) {
      const ref = existingAnnotsRef.get(i);
      const dict = context.lookupMaybe(ref, PDFDict);
      if (!dict) continue;
      const title = dict.get(PDFName.of('T'));
      const titleStr = title instanceof PDFString ? title.decodeText()
        : title instanceof PDFHexString ? title.decodeText()
        : null;
      if (titleStr === ANNOT_TITLE) continue; // strip old internal note
      existingAnnots.push(dict);
    }
  }

  // Build new /Annot Text sticky-note
  const annotDict = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: context.obj([x, y, x + 24, y + 24]),
    Contents: PDFString.of(opts.text),
    T: PDFString.of(ANNOT_TITLE),
    Open: PDFName.of('false'),
    Name: PDFName.of('Comment'),
    F: PDFNumber.of(4),   // Print flag
  });
  const annotRef = context.register(annotDict);

  // Merge with existing annotations
  const allAnnotRefs = existingAnnots.map(d => context.register(d));
  allAnnotRefs.push(annotRef);
  pageNode.set(PDFName.of('Annots'), context.obj(allAnnotRefs));

  return doc.save();
}
