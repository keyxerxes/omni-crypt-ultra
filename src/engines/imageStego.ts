/**
 * KEYXERXES // OMNI-CRYPT ULTRA — High-Capacity & Robust Image Steganography Engine
 *
 * 3 Selectable Modes:
 * 1. RGBA_2BIT  : Ultra-Capacity Lossless (2-bit LSB across R, G, B, A = 8 bits/pixel).
 *                 Uses pure-TS bit-exact PNG codec so browser Canvas2D premultiplied alpha
 *                 never corrupts channel LSBs on round-trip.
 * 2. RGB_1BIT   : Stealth 1-bit RGB LSB (3 bits/pixel, Alpha=255, PSNR > 51-65+ dB).
 * 3. DCT_SHIELD : Telegram / Social-Shield Mode — Auto-aligns image to <=1280px (8x8 blocks),
 *                 2D Type-II DCT on BT.601 Luminance (Y) mid-band pair (3,2) vs (2,3),
 *                 Hamming(7,4) Error-Correcting Code + 3x Spatial Majority Redundancy.
 *
 * Includes Forensic Diff Inspector (255x amplified bit-diff map, PSNR, MSE) and
 * Real Simulated JPEG Compression Survival Tester.
 */

import {
  CryptoAlgorithm,
  DecryptOptions,
  EncryptOptions,
  EncryptionMetrics,
  decryptBytes,
  encryptBytes,
} from '../core/cryptoSuite';
import { DecodedPayload, PayloadInput, packPayload, unpackPayload } from '../core/payloadFormat';
import { decodePngDirect, encodeRgbaToPng, isPngBytes } from '../core/pngCodec';

export type ImageStegoMode = 'RGBA_2BIT' | 'RGB_1BIT' | 'DCT_SHIELD';

export interface LoadedImageBuffer {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  fileName: string;
  fileSize: number;
}

export interface ImageCapacitySummary {
  rgba2BitBytes: number;
  rgb1BitBytes: number;
  dctShieldBytes: number;
  dctAlignedWidth: number;
  dctAlignedHeight: number;
}

export interface ForensicMetrics {
  psnrDb: number;
  mse: number;
  modifiedPixels: number;
  totalPixels: number;
  modifiedPercent: number;
  maxChannelDelta: number;
  diffDataUrl: string;
}

export interface ImageEmbedResult {
  stegoBlob: Blob;
  stegoUrl: string;
  originalAlignedUrl: string;
  width: number;
  height: number;
  mode: ImageStegoMode;
  ciphertext: Uint8Array;
  metrics: EncryptionMetrics;
  forensics: ForensicMetrics;
  stegoRgba: Uint8ClampedArray;
}

export interface ImageExtractResult {
  payload: DecodedPayload;
  algorithm: CryptoAlgorithm;
  detectedMode: ImageStegoMode;
  ciphertextBytes: number;
  eccCorrectedErrors: number;
  elapsedMs: number;
}

export interface JpegStressResult {
  quality: number;
  jpegSizeBytes: number;
  survived: boolean;
  eccCorrectedErrors: number;
  recoveredPreview?: string;
  errorMessage?: string;
}

// LSB Headers
const LSB_MAGIC_RGBA2 = [0x4b, 0x58, 0x52, 0x32]; // KXR2
const LSB_MAGIC_RGB1 = [0x4b, 0x58, 0x52, 0x31]; // KXR1

// DCT Shield Header & Constants
const DCT_MAGIC_0 = 0xd7;
const DCT_MAGIC_1 = 0x5c;
const DCT_MAX_DIM = 1280;
const DCT_REDUNDANCY = 3;
const DCT_STRENGTH = 42; // Differential gap in mid-frequency luminance DCT

// Precomputed 8x8 DCT cosine matrix
const COS_TABLE = new Float64Array(64);
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) {
    COS_TABLE[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  }
}
const ALPHA_TABLE = [1 / Math.SQRT2, 1, 1, 1, 1, 1, 1, 1];

// --- Image Loading Helpers ---

export async function loadImageFromBlob(
  blob: Blob,
  fileName = 'image.png'
): Promise<LoadedImageBuffer> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // Attempt bit-exact PNG direct decode first (essential for 2-bit RGBA LSB!)
  if (isPngBytes(bytes)) {
    try {
      const direct = await decodePngDirect(bytes);
      if (direct) {
        return {
          width: direct.width,
          height: direct.height,
          rgba: direct.rgba,
          fileName,
          fileSize: blob.size,
        };
      }
    } catch {
      // Fall through to standard browser ImageDecoder / Canvas
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('IMAGE_DECODE_FAILED: Unsupported or corrupt image file.'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    return {
      width: canvas.width,
      height: canvas.height,
      rgba: data.data,
      fileName,
      fileSize: blob.size,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function computeDctDimensions(width: number, height: number): { width: number; height: number } {
  let w = width;
  let h = height;
  if (w > DCT_MAX_DIM || h > DCT_MAX_DIM) {
    const scale = DCT_MAX_DIM / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  w = Math.max(64, Math.floor(w / 8) * 8);
  h = Math.max(64, Math.floor(h / 8) * 8);
  return { width: w, height: h };
}

export function calculateImageCapacities(width: number, height: number): ImageCapacitySummary {
  const pixels = width * height;
  // RGBA 2-bit: 1 byte per pixel minus 8-byte header
  const rgba2BitBytes = Math.max(0, pixels - 8);
  // RGB 1-bit: 3 bits per pixel minus 8-byte header
  const rgb1BitBytes = Math.max(0, Math.floor((pixels * 3) / 8) - 8);

  const aligned = computeDctDimensions(width, height);
  const totalBlocks = (aligned.width / 8) * (aligned.height / 8);
  // Each coded bit uses 3x spatial redundancy blocks; each byte uses 14 Hamming(7,4) bits
  const usableCodedBits = Math.floor(totalBlocks / DCT_REDUNDANCY);
  const totalBytes = Math.floor(usableCodedBits / 14);
  const dctShieldBytes = Math.max(0, totalBytes - 6); // 6-byte DCT frame header

  return {
    rgba2BitBytes,
    rgb1BitBytes,
    dctShieldBytes,
    dctAlignedWidth: aligned.width,
    dctAlignedHeight: aligned.height,
  };
}

function resizeRgba(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8ClampedArray(src);
  }
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sCtx = srcCanvas.getContext('2d')!;
  sCtx.putImageData(new ImageData(new Uint8ClampedArray(src), srcW, srcH), 0, 0);

  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = dstW;
  dstCanvas.height = dstH;
  const dCtx = dstCanvas.getContext('2d', { willReadFrequently: true })!;
  dCtx.imageSmoothingEnabled = true;
  dCtx.imageSmoothingQuality = 'high';
  dCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);
  return dCtx.getImageData(0, 0, dstW, dstH).data;
}

function rgbaToDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

// --- Forensic Diff & PSNR ---

export function computeForensics(
  original: Uint8ClampedArray,
  stego: Uint8ClampedArray,
  width: number,
  height: number
): ForensicMetrics {
  const totalPixels = width * height;
  const diffRgba = new Uint8ClampedArray(totalPixels * 4);
  let sumSqErr = 0;
  let modifiedPixels = 0;
  let maxChannelDelta = 0;

  for (let p = 0; p < totalPixels; p++) {
    const idx = p * 4;
    const dr = Math.abs(original[idx] - stego[idx]);
    const dg = Math.abs(original[idx + 1] - stego[idx + 1]);
    const db = Math.abs(original[idx + 2] - stego[idx + 2]);
    const da = Math.abs(original[idx + 3] - stego[idx + 3]);

    sumSqErr += dr * dr + dg * dg + db * db;
    const maxD = Math.max(dr, dg, db, da);
    if (maxD > maxChannelDelta) maxChannelDelta = maxD;
    if (maxD > 0) modifiedPixels++;

    // 255x amplified forensic diff visualization
    diffRgba[idx] = Math.min(255, dr * 255);
    diffRgba[idx + 1] = Math.min(255, dg * 255);
    diffRgba[idx + 2] = Math.min(255, db * 255);
    // Highlight alpha-only LSB changes in amber/emerald channel mix so they are visible
    if (dr === 0 && dg === 0 && db === 0 && da > 0) {
      diffRgba[idx] = 16;
      diffRgba[idx + 1] = Math.min(255, da * 128);
      diffRgba[idx + 2] = 129;
    }
    diffRgba[idx + 3] = 255;
  }

  const mse = sumSqErr / (totalPixels * 3);
  const psnrDb = mse === 0 ? 99.99 : Number((10 * Math.log10((255 * 255) / mse)).toFixed(2));

  // Downscale diff preview if huge for instant snappy canvas serialization
  let diffDataUrl: string;
  if (width > 960 || height > 960) {
    const scale = 960 / Math.max(width, height);
    const dw = Math.max(1, Math.round(width * scale));
    const dh = Math.max(1, Math.round(height * scale));
    const resized = resizeRgba(diffRgba, width, height, dw, dh);
    diffDataUrl = rgbaToDataUrl(resized, dw, dh);
  } else {
    diffDataUrl = rgbaToDataUrl(diffRgba, width, height);
  }

  return {
    psnrDb,
    mse: Number(mse.toFixed(4)),
    modifiedPixels,
    totalPixels,
    modifiedPercent: Number(((modifiedPixels / totalPixels) * 100).toFixed(2)),
    maxChannelDelta,
    diffDataUrl,
  };
}

// --- Mode 1: Ultra-Capacity Lossless (2-bit RGBA LSB) ---

function embedRgba2Bit(original: Uint8ClampedArray, ciphertext: Uint8Array): Uint8ClampedArray {
  const frame = new Uint8Array(8 + ciphertext.byteLength);
  frame.set(LSB_MAGIC_RGBA2, 0);
  new DataView(frame.buffer).setUint32(4, ciphertext.byteLength, false);
  frame.set(ciphertext, 8);

  const pixelCount = original.length / 4;
  if (frame.byteLength > pixelCount) {
    throw new Error(
      `CAPACITY_EXCEEDED: Payload (${frame.byteLength} B) exceeds 2-bit RGBA capacity (${pixelCount} B).`
    );
  }

  const out = new Uint8ClampedArray(original);
  for (let i = 0; i < frame.byteLength; i++) {
    const byte = frame[i];
    const pIdx = i * 4;
    out[pIdx] = (out[pIdx] & 0xfc) | ((byte >> 6) & 0x03);
    out[pIdx + 1] = (out[pIdx + 1] & 0xfc) | ((byte >> 4) & 0x03);
    out[pIdx + 2] = (out[pIdx + 2] & 0xfc) | ((byte >> 2) & 0x03);
    // Keep alpha top 6 bits >= 252 if pixel was opaque so it remains visually opaque (252..255)
    out[pIdx + 3] = (out[pIdx + 3] & 0xfc) | (byte & 0x03);
  }
  return out;
}

function extractRgba2Bit(rgba: Uint8ClampedArray): Uint8Array | null {
  const pixelCount = rgba.length / 4;
  if (pixelCount < 8) return null;

  const readByte = (i: number): number => {
    const p = i * 4;
    return (
      ((rgba[p] & 0x03) << 6) |
      ((rgba[p + 1] & 0x03) << 4) |
      ((rgba[p + 2] & 0x03) << 2) |
      (rgba[p + 3] & 0x03)
    );
  };

  for (let m = 0; m < 4; m++) {
    if (readByte(m) !== LSB_MAGIC_RGBA2[m]) return null;
  }

  const len =
    ((readByte(4) << 24) | (readByte(5) << 16) | (readByte(6) << 8) | readByte(7)) >>> 0;
  if (len === 0 || 8 + len > pixelCount) return null;

  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = readByte(8 + i);
  }
  return out;
}

// --- Mode 2: Stealth 1-bit RGB LSB ---

function embedRgb1Bit(original: Uint8ClampedArray, ciphertext: Uint8Array): Uint8ClampedArray {
  const frame = new Uint8Array(8 + ciphertext.byteLength);
  frame.set(LSB_MAGIC_RGB1, 0);
  new DataView(frame.buffer).setUint32(4, ciphertext.byteLength, false);
  frame.set(ciphertext, 8);

  const totalBits = frame.byteLength * 8;
  const maxBits = (original.length / 4) * 3;
  if (totalBits > maxBits) {
    throw new Error(
      `CAPACITY_EXCEEDED: Payload (${frame.byteLength} B) exceeds 1-bit RGB capacity (${Math.floor(maxBits / 8)} B).`
    );
  }

  const out = new Uint8ClampedArray(original);
  // Ensure Alpha is 255 on modified pixels so no alpha artifacts ever occur
  let channelCursor = 0;
  for (let i = 0; i < frame.byteLength; i++) {
    const byte = frame[i];
    for (let b = 7; b >= 0; b--) {
      const bit = (byte >> b) & 1;
      const pixelIdx = Math.floor(channelCursor / 3);
      const ch = channelCursor % 3;
      const rgbaIdx = pixelIdx * 4 + ch;
      out[rgbaIdx] = (out[rgbaIdx] & 0xfe) | bit;
      out[pixelIdx * 4 + 3] = 255;
      channelCursor++;
    }
  }
  return out;
}

function extractRgb1Bit(rgba: Uint8ClampedArray): Uint8Array | null {
  const maxBits = (rgba.length / 4) * 3;
  if (maxBits < 64) return null;

  const readBit = (bitIdx: number): number => {
    const pixelIdx = Math.floor(bitIdx / 3);
    const ch = bitIdx % 3;
    return rgba[pixelIdx * 4 + ch] & 1;
  };

  const readByte = (byteIdx: number): number => {
    let val = 0;
    const base = byteIdx * 8;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | readBit(base + b);
    }
    return val;
  };

  for (let m = 0; m < 4; m++) {
    if (readByte(m) !== LSB_MAGIC_RGB1[m]) return null;
  }

  const len =
    ((readByte(4) << 24) | (readByte(5) << 16) | (readByte(6) << 8) | readByte(7)) >>> 0;
  if (len === 0 || (8 + len) * 8 > maxBits) return null;

  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = readByte(8 + i);
  }
  return out;
}

// --- Mode 3: 2D-DCT + Hamming(7,4) ECC + 3x Spatial Redundancy (Telegram/Social Shield) ---

function crc16Ccitt(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    crc ^= bytes[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

// Hamming(7,4) Systematic Encoding: data bits d0,d1,d2,d3 -> [p1, p2, d0, p4, d1, d2, d3]
function hamming74EncodeNibble(nibble: number): number[] {
  const d0 = (nibble >> 3) & 1;
  const d1 = (nibble >> 2) & 1;
  const d2 = (nibble >> 1) & 1;
  const d3 = nibble & 1;
  const p1 = d0 ^ d1 ^ d3;
  const p2 = d0 ^ d2 ^ d3;
  const p4 = d1 ^ d2 ^ d3;
  return [p1, p2, d0, p4, d1, d2, d3];
}

function hamming74DecodeCodeword(cw: number[]): { nibble: number; corrected: boolean } {
  const b = cw.slice();
  const s1 = b[0] ^ b[2] ^ b[4] ^ b[6];
  const s2 = b[1] ^ b[2] ^ b[5] ^ b[6];
  const s4 = b[3] ^ b[4] ^ b[5] ^ b[6];
  const syndrome = s1 | (s2 << 1) | (s4 << 2);
  let corrected = false;
  if (syndrome > 0 && syndrome <= 7) {
    b[syndrome - 1] ^= 1;
    corrected = true;
  }
  const nibble = (b[2] << 3) | (b[4] << 2) | (b[5] << 1) | b[6];
  return { nibble, corrected };
}

function encodeBytesHamming74(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.byteLength; i++) {
    const hi = (bytes[i] >> 4) & 0x0f;
    const lo = bytes[i] & 0x0f;
    out.push(...hamming74EncodeNibble(hi), ...hamming74EncodeNibble(lo));
  }
  return out;
}

function decodeBitsHamming74(
  bits: number[],
  byteCount: number
): { bytes: Uint8Array; correctedErrors: number } {
  const out = new Uint8Array(byteCount);
  let correctedErrors = 0;
  for (let i = 0; i < byteCount; i++) {
    const base = i * 14;
    const hi = hamming74DecodeCodeword(bits.slice(base, base + 7));
    const lo = hamming74DecodeCodeword(bits.slice(base + 7, base + 14));
    if (hi.corrected) correctedErrors++;
    if (lo.corrected) correctedErrors++;
    out[i] = (hi.nibble << 4) | lo.nibble;
  }
  return { bytes: out, correctedErrors };
}

function forwardDct8x8(block: Float64Array, out: Float64Array): void {
  // Separable 1D DCT on rows then columns for fast, crisp performance
  const tmp = new Float64Array(64);
  for (let y = 0; y < 8; y++) {
    const rowOff = y * 8;
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      const cuOff = u * 8;
      for (let x = 0; x < 8; x++) {
        sum += block[rowOff + x] * COS_TABLE[cuOff + x];
      }
      tmp[rowOff + u] = 0.5 * ALPHA_TABLE[u] * sum;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      const cvOff = v * 8;
      for (let y = 0; y < 8; y++) {
        sum += tmp[y * 8 + u] * COS_TABLE[cvOff + y];
      }
      out[v * 8 + u] = 0.5 * ALPHA_TABLE[v] * sum;
    }
  }
}

function inverseDct8x8(coeff: Float64Array, out: Float64Array): void {
  const tmp = new Float64Array(64);
  for (let v = 0; v < 8; v++) {
    const rowOff = v * 8;
    for (let x = 0; x < 8; x++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        sum += ALPHA_TABLE[u] * coeff[rowOff + u] * COS_TABLE[u * 8 + x];
      }
      tmp[rowOff + x] = 0.5 * sum;
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let v = 0; v < 8; v++) {
        sum += ALPHA_TABLE[v] * tmp[v * 8 + x] * COS_TABLE[v * 8 + y];
      }
      out[y * 8 + x] = 0.5 * sum;
    }
  }
}

function embedDctShield(
  alignedRgba: Uint8ClampedArray,
  width: number,
  height: number,
  ciphertext: Uint8Array
): Uint8ClampedArray {
  if (ciphertext.byteLength > 65535) {
    throw new Error('PAYLOAD_TOO_LARGE: DCT Shield frame supports up to 65,535 bytes.');
  }

  // Frame: [Magic 2B][Length 2B BE][CRC16 2B BE][Ciphertext]
  const frame = new Uint8Array(6 + ciphertext.byteLength);
  frame[0] = DCT_MAGIC_0;
  frame[1] = DCT_MAGIC_1;
  frame[2] = (ciphertext.byteLength >> 8) & 0xff;
  frame[3] = ciphertext.byteLength & 0xff;
  const crc = crc16Ccitt(ciphertext);
  frame[4] = (crc >> 8) & 0xff;
  frame[5] = crc & 0xff;
  frame.set(ciphertext, 6);

  const codedBits = encodeBytesHamming74(frame);
  const blocksX = width / 8;
  const blocksY = height / 8;
  const totalBlocks = blocksX * blocksY;
  const stride = Math.floor(totalBlocks / DCT_REDUNDANCY);

  if (codedBits.length > stride) {
    const maxBytes = Math.max(0, Math.floor(stride / 14) - 6);
    throw new Error(
      `DCT_CAPACITY_EXCEEDED: Social-Shield payload (${ciphertext.byteLength} B) exceeds robust DCT capacity (${maxBytes} B) for ${width}x${height} image.`
    );
  }

  const out = new Uint8ClampedArray(alignedRgba);
  const blockY = new Float64Array(64);
  const dctCoeff = new Float64Array(64);
  const reconY = new Float64Array(64);

  // Mid-band symmetric frequency pair (u=3,v=2) and (u=2,v=3)
  const IDX_A = 2 * 8 + 3;
  const IDX_B = 3 * 8 + 2;

  for (let bitIdx = 0; bitIdx < codedBits.length; bitIdx++) {
    const bit = codedBits[bitIdx];

    for (let copy = 0; copy < DCT_REDUNDANCY; copy++) {
      const blockNum = copy * stride + bitIdx;
      const bx = (blockNum % blocksX) * 8;
      const by = Math.floor(blockNum / blocksX) * 8;

      // Extract 8x8 Y luminance centered around 0 (-128..+127)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const p = ((by + y) * width + (bx + x)) * 4;
          const r = out[p];
          const g = out[p + 1];
          const b = out[p + 2];
          blockY[y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
        }
      }

      forwardDct8x8(blockY, dctCoeff);

      // Differential mid-frequency modulation
      const cA = dctCoeff[IDX_A];
      const cB = dctCoeff[IDX_B];
      const avg = (cA + cB) * 0.5;
      const halfGap = DCT_STRENGTH * 0.5;
      if (bit === 1) {
        if (cA - cB < DCT_STRENGTH) {
          dctCoeff[IDX_A] = avg + halfGap;
          dctCoeff[IDX_B] = avg - halfGap;
        }
      } else {
        if (cB - cA < DCT_STRENGTH) {
          dctCoeff[IDX_A] = avg - halfGap;
          dctCoeff[IDX_B] = avg + halfGap;
        }
      }

      inverseDct8x8(dctCoeff, reconY);

      // Apply luminance delta back to RGB cleanly (preserves chroma)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const idx = y * 8 + x;
          const deltaY = reconY[idx] - blockY[idx];
          const p = ((by + y) * width + (bx + x)) * 4;
          out[p] = Math.max(0, Math.min(255, Math.round(out[p] + deltaY)));
          out[p + 1] = Math.max(0, Math.min(255, Math.round(out[p + 1] + deltaY)));
          out[p + 2] = Math.max(0, Math.min(255, Math.round(out[p + 2] + deltaY)));
          out[p + 3] = 255;
        }
      }
    }
  }

  return out;
}

function extractDctShield(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): { ciphertext: Uint8Array; eccCorrectedErrors: number } | null {
  const blocksX = Math.floor(width / 8);
  const blocksY = Math.floor(height / 8);
  const totalBlocks = blocksX * blocksY;
  const stride = Math.floor(totalBlocks / DCT_REDUNDANCY);
  if (stride < 6 * 14) return null;

  const blockY = new Float64Array(64);
  const dctCoeff = new Float64Array(64);
  const IDX_A = 2 * 8 + 3;
  const IDX_B = 3 * 8 + 2;

  const readVotedBit = (bitIdx: number): number => {
    let votes = 0;
    for (let copy = 0; copy < DCT_REDUNDANCY; copy++) {
      const blockNum = copy * stride + bitIdx;
      const bx = (blockNum % blocksX) * 8;
      const by = Math.floor(blockNum / blocksX) * 8;

      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const p = ((by + y) * width + (bx + x)) * 4;
          blockY[y * 8 + x] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2] - 128;
        }
      }
      forwardDct8x8(blockY, dctCoeff);
      if (dctCoeff[IDX_A] >= dctCoeff[IDX_B]) votes++;
    }
    return votes >= 2 ? 1 : 0;
  };

  // Decode 6-byte header (84 coded bits)
  const headerBits: number[] = new Array(84);
  for (let i = 0; i < 84; i++) {
    headerBits[i] = readVotedBit(i);
  }

  const headerDecoded = decodeBitsHamming74(headerBits, 6);
  const h = headerDecoded.bytes;
  if (h[0] !== DCT_MAGIC_0 || h[1] !== DCT_MAGIC_1) {
    return null;
  }

  const payloadLen = (h[2] << 8) | h[3];
  const expectedCrc = (h[4] << 8) | h[5];
  const totalCodedBits = (6 + payloadLen) * 14;
  if (payloadLen === 0 || totalCodedBits > stride) {
    return null;
  }

  const payloadBits: number[] = new Array(payloadLen * 14);
  for (let i = 0; i < payloadLen * 14; i++) {
    payloadBits[i] = readVotedBit(84 + i);
  }

  const payloadDecoded = decodeBitsHamming74(payloadBits, payloadLen);
  const actualCrc = crc16Ccitt(payloadDecoded.bytes);
  if (actualCrc !== expectedCrc) {
    return null;
  }

  return {
    ciphertext: payloadDecoded.bytes,
    eccCorrectedErrors: headerDecoded.correctedErrors + payloadDecoded.correctedErrors,
  };
}

// --- Public High-Level Image Engine API ---

export async function embedInImage(
  cover: LoadedImageBuffer,
  payloadInput: PayloadInput,
  mode: ImageStegoMode,
  cryptoOptions: EncryptOptions
): Promise<ImageEmbedResult> {
  const packed = packPayload(payloadInput);
  const { ciphertext, metrics } = await encryptBytes(packed, cryptoOptions);

  let width = cover.width;
  let height = cover.height;
  let baseRgba = cover.rgba;

  if (mode === 'DCT_SHIELD') {
    const aligned = computeDctDimensions(cover.width, cover.height);
    width = aligned.width;
    height = aligned.height;
    baseRgba = resizeRgba(cover.rgba, cover.width, cover.height, width, height);
  }

  let stegoRgba: Uint8ClampedArray;
  if (mode === 'RGBA_2BIT') {
    stegoRgba = embedRgba2Bit(baseRgba, ciphertext);
  } else if (mode === 'RGB_1BIT') {
    stegoRgba = embedRgb1Bit(baseRgba, ciphertext);
  } else {
    stegoRgba = embedDctShield(baseRgba, width, height, ciphertext);
  }

  // Export bit-exact lossless PNG (prevents Canvas2D premultiplied alpha loss!)
  const pngBytes = await encodeRgbaToPng(stegoRgba, width, height);
  const stegoBlob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
  const stegoUrl = URL.createObjectURL(stegoBlob);

  // Original aligned reference for Forensic Inspector
  const origPngBytes = await encodeRgbaToPng(baseRgba, width, height);
  const originalAlignedUrl = URL.createObjectURL(
    new Blob([new Uint8Array(origPngBytes)], { type: 'image/png' })
  );

  const forensics = computeForensics(baseRgba, stegoRgba, width, height);

  return {
    stegoBlob,
    stegoUrl,
    originalAlignedUrl,
    width,
    height,
    mode,
    ciphertext,
    metrics,
    forensics,
    stegoRgba,
  };
}

export async function extractFromImageBlob(
  stegoBlob: Blob,
  preferredMode: ImageStegoMode | 'AUTO',
  decryptOptions: DecryptOptions
): Promise<ImageExtractResult> {
  const loaded = await loadImageFromBlob(stegoBlob);

  let detectedMode: ImageStegoMode | null = null;
  let ciphertext: Uint8Array | null = null;
  let eccCorrectedErrors = 0;

  const tryOrder: ImageStegoMode[] =
    preferredMode === 'AUTO'
      ? ['RGBA_2BIT', 'RGB_1BIT', 'DCT_SHIELD']
      : [preferredMode];

  for (const mode of tryOrder) {
    if (mode === 'RGBA_2BIT') {
      const res = extractRgba2Bit(loaded.rgba);
      if (res) {
        ciphertext = res;
        detectedMode = 'RGBA_2BIT';
        break;
      }
    } else if (mode === 'RGB_1BIT') {
      const res = extractRgb1Bit(loaded.rgba);
      if (res) {
        ciphertext = res;
        detectedMode = 'RGB_1BIT';
        break;
      }
    } else if (mode === 'DCT_SHIELD') {
      const res = extractDctShield(loaded.rgba, loaded.width, loaded.height);
      if (res) {
        ciphertext = res.ciphertext;
        eccCorrectedErrors = res.eccCorrectedErrors;
        detectedMode = 'DCT_SHIELD';
        break;
      }
    }
  }

  if (!ciphertext || !detectedMode) {
    throw new Error(
      'NO_IMAGE_PAYLOAD_DETECTED: No valid RGBA-2bit, RGB-1bit, or 2D-DCT carrier header found.'
    );
  }

  const decrypted = await decryptBytes(ciphertext, decryptOptions);
  const payload = unpackPayload(decrypted.plaintext);

  return {
    payload,
    algorithm: decrypted.algorithm,
    detectedMode,
    ciphertextBytes: ciphertext.byteLength,
    eccCorrectedErrors,
    elapsedMs: decrypted.elapsedMs,
  };
}

/**
 * Real Simulated JPEG Compression Survival Tester (runs actual browser JPEG re-encoding
 * at target quality and attempts full DCT/LSB extraction + decryption).
 */
export async function runJpegStressTest(
  stegoRgba: Uint8ClampedArray,
  width: number,
  height: number,
  quality: number,
  decryptOptions: DecryptOptions
): Promise<JpegStressResult> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(stegoRgba), width, height), 0, 0);

  const jpegBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('JPEG_ENCODE_FAILED'))),
      'image/jpeg',
      quality
    );
  });

  try {
    const extracted = await extractFromImageBlob(jpegBlob, 'AUTO', decryptOptions);
    const recoveredPreview =
      extracted.payload.kind === 'text'
        ? extracted.payload.text.slice(0, 120)
        : `FILE: ${extracted.payload.fileName} (${extracted.payload.byteLength} B)`;
    return {
      quality,
      jpegSizeBytes: jpegBlob.size,
      survived: true,
      eccCorrectedErrors: extracted.eccCorrectedErrors,
      recoveredPreview,
    };
  } catch (err) {
    return {
      quality,
      jpegSizeBytes: jpegBlob.size,
      survived: false,
      eccCorrectedErrors: 0,
      errorMessage: err instanceof Error ? err.message : 'Extraction failed after JPEG compression.',
    };
  }
}
