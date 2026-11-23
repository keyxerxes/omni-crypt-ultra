/**
 * Bit-Exact Pure-TypeScript RGBA PNG Encoder & Decoder.
 *
 * WHY THIS EXISTS:
 * HTML5 Canvas2D uses premultiplied alpha during drawImage()/getImageData() round-trips.
 * When embedding 2-bit RGBA LSB steganography (modifying the Alpha channel LSBs),
 * Canvas2D premultiplication rounds and destroys R/G/B LSBs upon re-import.
 * This pure-TS PNG codec bypasses Canvas2D premultiplication completely,
 * guaranteeing 100% bit-exact lossless 8-bit RGBA storage and extraction.
 */

import { zlibCompress, zlibDecompress } from './compression';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// Precomputed CRC-32 table (IEEE 802.3)
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.byteLength));
  view.setUint32(8 + data.byteLength, crc, false);
  return chunk;
}

/**
 * Encodes raw un-premultiplied RGBA pixel data into a valid 8-bit RGBA PNG binary.
 */
export async function encodeRgbaToPng(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): Promise<Uint8Array> {
  const stride = width * 4;
  const rawScanlines = new Uint8Array(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    const dstRow = y * (stride + 1);
    const srcRow = y * stride;
    rawScanlines[dstRow] = 0; // Filter type 0: None (fast & bit-exact)
    rawScanlines.set(rgba.subarray(srcRow, srcRow + stride), dstRow + 1);
  }

  const compressedIdat = await zlibCompress(rawScanlines);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // Color type: Truecolor + Alpha (RGBA)
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace: none

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', compressedIdat);
  const iend = makeChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length);
  let offset = 0;
  out.set(PNG_SIGNATURE, offset);
  offset += PNG_SIGNATURE.length;
  out.set(ihdr, offset);
  offset += ihdr.length;
  out.set(idat, offset);
  offset += idat.length;
  out.set(iend, offset);
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Decodes an 8-bit RGB or RGBA non-interlaced PNG directly to raw un-premultiplied RGBA.
 * Returns null if the PNG uses palette/interlacing/other bit-depths (caller falls back to Canvas2D).
 */
export async function decodePngDirect(
  bytes: Uint8Array
): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null> {
  if (!isPngBytes(bytes)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;

  const idatChunks: Uint8Array[] = [];
  let totalIdatLen = 0;

  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.byteLength) break;

    if (type === 'IHDR' && length >= 13) {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'IDAT') {
      const slice = bytes.subarray(dataStart, dataEnd);
      idatChunks.push(slice);
      totalIdatLen += slice.byteLength;
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  // Only handle standard 8-bit non-interlaced RGB (2) or RGBA (6)
  if (width === 0 || height === 0 || bitDepth !== 8 || interlace !== 0) return null;
  if (colorType !== 6 && colorType !== 2) return null;

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;

  const mergedIdat = new Uint8Array(totalIdatLen);
  let idatPos = 0;
  for (const chunk of idatChunks) {
    mergedIdat.set(chunk, idatPos);
    idatPos += chunk.byteLength;
  }

  const raw = await zlibDecompress(mergedIdat);
  if (raw.byteLength < height * (stride + 1)) return null;

  const recon = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const srcStart = y * (stride + 1) + 1;
    const dstStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const filt = raw[srcStart + x];
      const a = x >= bpp ? recon[dstStart + x - bpp] : 0;
      const b = y > 0 ? recon[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? recon[prevStart + x - bpp] : 0;

      let val = filt;
      if (filterType === 1) val = (filt + a) & 0xff;
      else if (filterType === 2) val = (filt + b) & 0xff;
      else if (filterType === 3) val = (filt + ((a + b) >> 1)) & 0xff;
      else if (filterType === 4) val = (filt + paethPredictor(a, b, c)) & 0xff;

      recon[dstStart + x] = val;
    }
  }

  if (colorType === 6) {
    return { width, height, rgba: new Uint8ClampedArray(recon.buffer) };
  }

  // Expand RGB to RGBA
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
    rgba[j] = recon[i];
    rgba[j + 1] = recon[i + 1];
    rgba[j + 2] = recon[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}
