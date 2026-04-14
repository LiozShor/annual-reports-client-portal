# DL-163: Fix PNG-to-PDF Conversion for RGBA Screenshots

**Status:** Completed
**Date:** 2026-03-17
**Workflow:** WF[05] `cIa23K8v1PrbDJqY` — `Image to PDF` node (`image-to-pdf`)

## Problem

Client sent 2 PNG screenshots for classification. They remained as PNG in OneDrive instead of being converted to PDF. Two-layer failure:

1. **Tier 1 (Image to PDF node)**: Only supported colorType 0 (grayscale) and colorType 2 (RGB). Screenshots are RGBA (colorType 6 with alpha channel) — rejected as `unsupported_variant`.
2. **Tier 2 (Check If PDF → MS Graph)**: MS Graph `?format=pdf` does NOT support images — only Office docs. Cannot help with image conversion.

## Solution

Extended `pngToPdf()` in the `Image to PDF` Code node to handle:
- **colorType 4** — Grayscale + Alpha (GA)
- **colorType 6** — RGBA

### Implementation

n8n Cloud disallows `require('zlib')` in Code nodes — implemented pure-JS inflate/deflate.

For alpha-bearing PNGs, the code now:
1. Decompresses IDAT chunks via `pureInflate()` (pure-JS DEFLATE: stored, fixed Huffman, dynamic Huffman, LZ77)
2. Reverses PNG scanline filters (None, Sub, Up, Average, Paeth) via `unfilterScanlines()`
3. Flattens alpha channel against white background via `flattenAlpha()` — produces clean RGB/Gray pixels
4. Re-compresses with `pureDeflate()` (stored-block zlib — no actual compression, valid FlateDecode)
5. Builds PDF via existing `buildImagePdf()` with `/FlateDecode` filter and no `/DecodeParms`

### Why flatten to white (not SMask)?

- Tax documents on white paper — transparency adds no value
- Simpler code, fewer PDF objects, fewer bugs
- Matches how documents will be printed/viewed

### What's unchanged

- colorType 0 (grayscale) and 2 (RGB) — existing direct IDAT passthrough with PNG predictor
- JPEG handling — untouched
- Interlaced PNGs — still rejected (complex 7-pass layout, rare case)
- Palette PNGs (colorType 3) — still rejected
- Data flow: `Image to PDF → Upload to OneDrive → Check If PDF → IF Needs Conversion (FALSE) → Prep Doc Update`

## New helper functions

- `pureInflate(buf)` — pure-JS DEFLATE decompression (stored, fixed Huffman, dynamic Huffman, LZ77 back-refs)
- `pureDeflate(data)` — stored-block zlib compression (valid FlateDecode wrapper, no actual compression)
- `unfilterScanlines(raw, width, height, bpp)` — reverses all 5 PNG filter types
- `paethPredictor(a, b, c)` — Paeth filter predictor
- `flattenAlpha(pixels, width, height, colorType)` — composites against white background

## Gotcha: n8n Cloud Module Restrictions

`require('zlib')` is disallowed in n8n Cloud's sandboxed JS task runner. First deploy attempt (exec 9689) failed with `Module 'zlib' is disallowed`. Fixed by implementing pure-JS inflate/deflate.

## Bugs encountered during implementation

1. **`Module 'zlib' is disallowed` (exec 9689)** — n8n Cloud sandbox blocks `require('zlib')`. Fixed by implementing pure-JS inflate/deflate.
2. **Adler-32 overflow (exec 9710)** — `pureDeflate` Adler-32 checksum `(b << 16) | a` produced negative number because JS `<<` operates on signed 32-bit ints. Fixed: `((b << 16) | a) >>> 0`.

## Verification

- [x] Re-trigger client's RGBA PNG email or send test (exec 9713, 3 test files)
- [x] Check `_img_converted: true` in Image to PDF output
- [x] Verify `.pdf` file in OneDrive (not `.png`) — all 3 confirmed as PDF
- [x] Open PDF — image renders correctly with white background
- [x] Regression: JPG still converts (send2.jpg → PDF)
- [x] Regression: Non-alpha PNG still converts (send3.png colorType 2 → PDF)
- [ ] Regression: PDF passes through unchanged (not explicitly tested, but unchanged code path)

## Key executions

| Exec | Result | Notes |
|------|--------|-------|
| 9689 | Error | `Module 'zlib' is disallowed` — led to pure-JS rewrite |
| 9690 | Success | First working pure-JS version (client's real RGBA PNGs) |
| 9710 | Error | Adler-32 signed int overflow in `pureDeflate` |
| 9711 | Success | Adler-32 fix verified (previous test batch) |
| 9713 | Success | Final verification — 3 realistic test files (RGBA PNG, JPG, RGB PNG) all converted to PDF |
