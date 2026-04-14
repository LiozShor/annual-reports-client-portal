// image-to-pdf.ts — Convert JPEG/PNG images to minimal valid PDFs
// Uses only Web APIs (Uint8Array, DataView, TextEncoder, CompressionStream/DecompressionStream)
// No Node.js Buffer — compatible with Cloudflare Workers

const encoder = new TextEncoder();

// ── Uint8Array helpers ─────────────────────────────────────────────

function readUint16BE(arr: Uint8Array, offset: number): number {
  return (arr[offset] << 8) | arr[offset + 1];
}

function readUint32BE(arr: Uint8Array, offset: number): number {
  const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  return view.getUint32(offset, false);
}

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

function textToBytes(str: string): Uint8Array {
  return encoder.encode(str);
}

// ── Inflate / Deflate via Web Streams ──────────────────────────────

async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
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

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(raw);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatArrays(...chunks);
}

// ── PDF builder ────────────────────────────────────────────────────

interface ImageInfo {
  width: number;
  height: number;
  colorSpace: string;
  bitsPerComponent: number;
  filter: string;
  decodeParms?: string;
  streamData: Uint8Array;
}

function buildImagePdf(info: ImageInfo): Uint8Array {
  const {
    width,
    height,
    colorSpace,
    bitsPerComponent,
    filter,
    decodeParms,
    streamData,
  } = info;

  // Content stream: draw image scaled to page size
  const contentStr = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const contentBytes = textToBytes(contentStr);

  // Build objects as strings (except stream data which is binary)
  const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\nendobj\n`;
  const obj4 = `4 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`;
  const obj4End = `\nendstream\nendobj\n`;

  // Image XObject dict
  let imageDict = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent ${bitsPerComponent} /Filter ${filter} /Length ${streamData.length}`;
  if (decodeParms) {
    imageDict += ` /DecodeParms ${decodeParms}`;
  }
  imageDict += ` >>`;
  const obj5 = `5 0 obj\n${imageDict}\nstream\n`;
  const obj5End = `\nendstream\nendobj\n`;

  // Convert text parts to bytes
  const header = textToBytes('%PDF-1.4\n');
  const b1 = textToBytes(obj1);
  const b2 = textToBytes(obj2);
  const b3 = textToBytes(obj3);
  const b4Start = textToBytes(obj4);
  const b4End = textToBytes(obj4End);
  const b5Start = textToBytes(obj5);
  const b5End = textToBytes(obj5End);

  // Calculate offsets for xref
  const offsets: number[] = [0]; // obj 0 is free, offset 0
  let pos = header.length;

  // obj 1
  offsets.push(pos);
  pos += b1.length;

  // obj 2
  offsets.push(pos);
  pos += b2.length;

  // obj 3
  offsets.push(pos);
  pos += b3.length;

  // obj 4
  offsets.push(pos);
  pos += b4Start.length + contentBytes.length + b4End.length;

  // obj 5
  offsets.push(pos);
  pos += b5Start.length + streamData.length + b5End.length;

  const xrefOffset = pos;

  // Build xref table
  let xref = 'xref\n0 6\n';
  // Entry for obj 0 (free)
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const bXref = textToBytes(xref);
  const bTrailer = textToBytes(trailer);

  return concatArrays(
    header,
    b1,
    b2,
    b3,
    b4Start,
    contentBytes,
    b4End,
    b5Start,
    streamData,
    b5End,
    bXref,
    bTrailer,
  );
}

// ── JPEG → PDF ─────────────────────────────────────────────────────

function jpegToPdf(imageBytes: Uint8Array): Uint8Array | null {
  // Find SOF marker (SOF0-SOF3: 0xFFC0-0xFFC3) to get dimensions
  let width = 0;
  let height = 0;
  let components = 0;
  let found = false;

  let i = 0;
  while (i < imageBytes.length - 1) {
    if (imageBytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = imageBytes[i + 1];

    // SOF0-SOF3
    if (marker >= 0xc0 && marker <= 0xc3) {
      if (i + 9 >= imageBytes.length) return null;
      height = readUint16BE(imageBytes, i + 5);
      width = readUint16BE(imageBytes, i + 7);
      components = imageBytes[i + 9];
      found = true;
      break;
    }

    // Skip non-SOF markers with length
    if (marker === 0xd8 || marker === 0xd9) {
      // SOI or EOI — no length field
      i += 2;
    } else if (marker >= 0xd0 && marker <= 0xd7) {
      // RST markers — no length field
      i += 2;
    } else {
      // Marker with length
      if (i + 3 >= imageBytes.length) return null;
      const len = readUint16BE(imageBytes, i + 2);
      i += 2 + len;
    }
  }

  if (!found || width === 0 || height === 0) return null;

  const colorSpace =
    components === 1 ? '/DeviceGray' : '/DeviceRGB';

  return buildImagePdf({
    width,
    height,
    colorSpace,
    bitsPerComponent: 8,
    filter: '/DCTDecode',
    streamData: imageBytes,
  });
}

// ── PNG → PDF ──────────────────────────────────────────────────────

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** Paeth predictor */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Un-filter PNG scanlines in-place, returning raw pixel data (no filter bytes) */
function unfilterScanlines(
  raw: Uint8Array,
  width: number,
  height: number,
  bpp: number, // bytes per pixel
): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);

  // Previous row buffer (starts as zeros)
  const prev = new Uint8Array(stride);

  let srcOffset = 0;

  for (let y = 0; y < height; y++) {
    const filterType = raw[srcOffset++];
    const rowStart = y * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[srcOffset++];
      const left = x >= bpp ? out[rowStart + x - bpp] : 0;
      const above = prev[x];
      const upperLeft = x >= bpp ? prev[x - bpp] : 0;

      let val: number;
      switch (filterType) {
        case 0: // None
          val = rawByte;
          break;
        case 1: // Sub
          val = (rawByte + left) & 0xff;
          break;
        case 2: // Up
          val = (rawByte + above) & 0xff;
          break;
        case 3: // Average
          val = (rawByte + ((left + above) >>> 1)) & 0xff;
          break;
        case 4: // Paeth
          val = (rawByte + paeth(left, above, upperLeft)) & 0xff;
          break;
        default:
          val = rawByte;
      }
      out[rowStart + x] = val;
    }

    // Copy current row to prev for next iteration
    prev.set(out.subarray(rowStart, rowStart + stride));
  }

  return out;
}

/** Flatten alpha channel by blending to white background */
function flattenAlpha(
  pixels: Uint8Array,
  width: number,
  height: number,
  colorType: number,
): Uint8Array {
  const isGrayAlpha = colorType === 4;
  const srcBpp = isGrayAlpha ? 2 : 4; // gray+A or RGBA
  const dstBpp = isGrayAlpha ? 1 : 3; // gray or RGB
  const totalPixels = width * height;
  const out = new Uint8Array(totalPixels * dstBpp);

  for (let i = 0; i < totalPixels; i++) {
    const srcIdx = i * srcBpp;
    const dstIdx = i * dstBpp;

    if (isGrayAlpha) {
      const gray = pixels[srcIdx];
      const alpha = pixels[srcIdx + 1];
      const af = alpha / 255;
      const bf = 1 - af;
      out[dstIdx] = Math.round(gray * af + 255 * bf);
    } else {
      const r = pixels[srcIdx];
      const g = pixels[srcIdx + 1];
      const b = pixels[srcIdx + 2];
      const alpha = pixels[srcIdx + 3];
      const af = alpha / 255;
      const bf = 1 - af;
      out[dstIdx] = Math.round(r * af + 255 * bf);
      out[dstIdx + 1] = Math.round(g * af + 255 * bf);
      out[dstIdx + 2] = Math.round(b * af + 255 * bf);
    }
  }

  return out;
}

/** Collect all IDAT chunk data from a PNG */
function collectIdatData(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 8; // skip PNG signature

  while (offset + 8 <= data.length) {
    const chunkLen = readUint32BE(data, offset);
    const chunkType =
      String.fromCharCode(data[offset + 4]) +
      String.fromCharCode(data[offset + 5]) +
      String.fromCharCode(data[offset + 6]) +
      String.fromCharCode(data[offset + 7]);

    if (chunkType === 'IDAT') {
      chunks.push(data.subarray(offset + 8, offset + 8 + chunkLen));
    }

    // Move past: length(4) + type(4) + data(chunkLen) + CRC(4)
    offset += 8 + chunkLen + 4;
  }

  return concatArrays(...chunks);
}

async function pngToPdf(imageBytes: Uint8Array): Promise<Uint8Array | null> {
  if (!isPng(imageBytes)) return null;
  if (imageBytes.length < 29) return null;

  // Read IHDR
  const width = readUint32BE(imageBytes, 16);
  const height = readUint32BE(imageBytes, 20);
  const bitDepth = imageBytes[24];
  const colorType = imageBytes[25];
  const interlace = imageBytes[28];

  // Reject interlaced PNGs
  if (interlace !== 0) return null;

  // Validate supported color types
  if (![0, 2, 4, 6].includes(colorType)) return null;

  const idatData = collectIdatData(imageBytes);
  if (idatData.length === 0) return null;

  const hasAlpha = colorType === 4 || colorType === 6;

  if (!hasAlpha) {
    // No alpha — embed IDAT data directly with FlateDecode + predictor
    const colors = colorType === 0 ? 1 : 3;
    const decodeParms = `<< /Predictor 15 /Colors ${colors} /BitsPerComponent ${bitDepth} /Columns ${width} >>`;
    const colorSpace = colorType === 0 ? '/DeviceGray' : '/DeviceRGB';

    return buildImagePdf({
      width,
      height,
      colorSpace,
      bitsPerComponent: bitDepth,
      filter: '/FlateDecode',
      decodeParms,
      streamData: idatData,
    });
  }

  // Alpha path: decompress, un-filter, flatten alpha, re-compress
  let decompressed: Uint8Array;
  try {
    decompressed = await inflate(idatData);
  } catch {
    return null;
  }

  // Bytes per pixel for the source (with alpha)
  const srcBpp = colorType === 4 ? 2 : 4;

  const pixels = unfilterScanlines(decompressed, width, height, srcBpp);
  const flattened = flattenAlpha(pixels, width, height, colorType);

  // Re-apply PNG sub-filter (filter type 1) for better compression
  const dstBpp = colorType === 4 ? 1 : 3;
  const stride = width * dstBpp;
  const filtered = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    const outStart = y * (1 + stride);
    filtered[outStart] = 0; // filter type None (simpler, still valid)
    filtered.set(flattened.subarray(rowStart, rowStart + stride), outStart + 1);
  }

  let compressed: Uint8Array;
  try {
    compressed = await deflate(filtered);
  } catch {
    return null;
  }

  const colors = colorType === 4 ? 1 : 3;
  const colorSpace = colorType === 4 ? '/DeviceGray' : '/DeviceRGB';
  const decodeParms = `<< /Predictor 15 /Colors ${colors} /BitsPerComponent ${bitDepth} /Columns ${width} >>`;

  return buildImagePdf({
    width,
    height,
    colorSpace,
    bitsPerComponent: bitDepth,
    filter: '/FlateDecode',
    decodeParms,
    streamData: compressed,
  });
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Convert a JPEG or PNG image to a minimal valid PDF.
 * Returns null if the image type is unsupported or conversion fails.
 */
export async function imageToPdf(
  imageBytes: Uint8Array,
  mimeType: string,
): Promise<Uint8Array | null> {
  try {
    const mime = mimeType.toLowerCase();

    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      return jpegToPdf(imageBytes);
    }

    if (mime === 'image/png') {
      return pngToPdf(imageBytes);
    }

    return null;
  } catch {
    return null;
  }
}
