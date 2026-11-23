/**
 * KEYXERXES // OMNI-CRYPT ULTRA — High-Capacity Video & Universal Container Engine
 *
 * Embeds massive encrypted payloads (text or arbitrary binary files) into .mp4 / .mov / .webm
 * video containers with ZERO re-encoding lag and 100% original video quality preservation:
 * - ISO-BMFF (.mp4, .mov, .m4v): Appends a spec-compliant ISO-BMFF `uuid` atom containing
 *   a custom 16-byte KEYXERXES UUID + uint32 payload length + CRC32 + encrypted ciphertext.
 * - EBML (.webm, .mkv) & Universal Binary: Appends a valid EBML `Void` element (0xEC)
 *   carrying our authenticated `KXUV` footer envelope, ignored by media demuxers.
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
import { crc32 } from '../core/pngCodec';

export type VideoContainerKind = 'ISO-BMFF' | 'EBML-WEBM' | 'UNIVERSAL';

export interface ContainerBoxEntry {
  type: string;
  offset: number;
  size: number;
  isKeyxerxesPayload?: boolean;
}

export interface VideoInspectionResult {
  containerKind: VideoContainerKind;
  fileSize: number;
  boxes: ContainerBoxEntry[];
  hasKeyxerxesAtom: boolean;
}

export interface VideoEmbedResult {
  stegoBlob: Blob;
  stegoUrl: string;
  fileName: string;
  mimeType: string;
  containerKind: VideoContainerKind;
  originalSize: number;
  stegoSize: number;
  atomOverheadBytes: number;
  boxes: ContainerBoxEntry[];
  ciphertext: Uint8Array;
  metrics: EncryptionMetrics;
}

export interface VideoExtractResult {
  payload: DecodedPayload;
  algorithm: CryptoAlgorithm;
  containerKind: VideoContainerKind;
  ciphertextBytes: number;
  elapsedMs: number;
}

// 16-byte custom ISO-BMFF UUID: "KXULTRASTEGOVID1"
const KX_UUID = new Uint8Array([
  0x4b, 0x58, 0x55, 0x4c, 0x54, 0x52, 0x41, 0x53,
  0x54, 0x45, 0x47, 0x4f, 0x56, 0x49, 0x44, 0x31,
]);

// EBML Void / Universal footer magic: "KXUV"
const KXUV_MAGIC = new Uint8Array([0x4b, 0x58, 0x55, 0x56]);

function bytesEqual(a: Uint8Array, aOff: number, b: Uint8Array): boolean {
  if (aOff + b.length > a.byteLength) return false;
  for (let i = 0; i < b.length; i++) {
    if (a[aOff + i] !== b[i]) return false;
  }
  return true;
}

export function detectContainerKind(bytes: Uint8Array, fileName: string): VideoContainerKind {
  // Check ISO-BMFF signature: bytes[4..7] === 'ftyp' or common MP4 top-level atoms
  if (bytes.byteLength >= 12) {
    const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (boxType === 'ftyp' || boxType === 'moov' || boxType === 'mdat' || boxType === 'free') {
      return 'ISO-BMFF';
    }
    // EBML header magic: 0x1A 0x45 0xDF 0xA3
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return 'EBML-WEBM';
    }
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.m4v')) {
    return 'ISO-BMFF';
  }
  if (lower.endsWith('.webm') || lower.endsWith('.mkv')) {
    return 'EBML-WEBM';
  }
  return 'UNIVERSAL';
}

/**
 * Parses top-level ISO-BMFF boxes (ftyp, moov, mdat, free, uuid, etc.) for forensic inspection.
 */
export function inspectVideoContainer(bytes: Uint8Array, fileName: string): VideoInspectionResult {
  const containerKind = detectContainerKind(bytes, fileName);
  const boxes: ContainerBoxEntry[] = [];
  let hasKeyxerxesAtom = false;

  if (containerKind === 'ISO-BMFF') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    let guard = 0;
    while (offset + 8 <= bytes.byteLength && guard < 128) {
      guard++;
      const size32 = view.getUint32(offset, false);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      let boxSize = size32;
      let headerLen = 8;

      if (size32 === 1 && offset + 16 <= bytes.byteLength) {
        const hi = view.getUint32(offset + 8, false);
        const lo = view.getUint32(offset + 12, false);
        boxSize = hi * 4294967296 + lo;
        headerLen = 16;
      } else if (size32 === 0) {
        boxSize = bytes.byteLength - offset;
      }

      if (boxSize < 8 || offset + boxSize > bytes.byteLength) break;

      const isKx =
        type === 'uuid' &&
        offset + headerLen + 16 <= bytes.byteLength &&
        bytesEqual(bytes, offset + headerLen, KX_UUID);
      if (isKx) hasKeyxerxesAtom = true;

      boxes.push({
        type,
        offset,
        size: boxSize,
        isKeyxerxesPayload: isKx,
      });
      offset += boxSize;
    }
  } else {
    // EBML or Universal summary
    boxes.push({
      type: containerKind === 'EBML-WEBM' ? 'EBML Segment' : 'Binary Stream',
      offset: 0,
      size: bytes.byteLength,
    });
    const found = findEbmlVoidPayload(bytes);
    if (found) {
      hasKeyxerxesAtom = true;
      boxes.push({
        type: 'Void (KXUV)',
        offset: found.atomOffset,
        size: bytes.byteLength - found.atomOffset,
        isKeyxerxesPayload: true,
      });
    }
  }

  return {
    containerKind,
    fileSize: bytes.byteLength,
    boxes,
    hasKeyxerxesAtom,
  };
}

function buildIsoBmffUuidAtom(ciphertext: Uint8Array): Uint8Array {
  // Layout: [size 4B]['uuid' 4B][KX_UUID 16B][payloadLen 4B][CRC32 4B][ciphertext]
  const totalSize = 8 + 16 + 4 + 4 + ciphertext.byteLength;
  const atom = new Uint8Array(totalSize);
  const view = new DataView(atom.buffer);

  view.setUint32(0, totalSize, false);
  atom[4] = 0x75; // 'u'
  atom[5] = 0x75; // 'u'
  atom[6] = 0x69; // 'i'
  atom[7] = 0x64; // 'd'
  atom.set(KX_UUID, 8);
  view.setUint32(24, ciphertext.byteLength, false);
  view.setUint32(28, crc32(ciphertext), false);
  atom.set(ciphertext, 32);
  return atom;
}

function buildEbmlVoidAtom(ciphertext: Uint8Array): Uint8Array {
  // EBML Void Element ID = 0xEC, 8-byte VINT size (0x01 + 7 bytes = clean universal EBML VINT)
  // Body: [KXUV 4B][payloadLen 4B][CRC32 4B][ciphertext][KXUV 4B][totalAtomSize 4B]
  const bodySize = 4 + 4 + 4 + ciphertext.byteLength + 8;
  const totalSize = 1 + 8 + bodySize;
  const atom = new Uint8Array(totalSize);
  const view = new DataView(atom.buffer);

  atom[0] = 0xec; // EBML Void Element ID
  // 8-byte EBML VINT data size (leading marker bit 0x01 in byte 1)
  atom[1] = 0x01;
  atom[2] = 0x00;
  atom[3] = 0x00;
  atom[4] = 0x00;
  view.setUint32(5, bodySize, false);

  atom.set(KXUV_MAGIC, 9);
  view.setUint32(13, ciphertext.byteLength, false);
  view.setUint32(17, crc32(ciphertext), false);
  atom.set(ciphertext, 21);

  // Footer trailer for instant O(1) seek from EOF
  const footerOff = 21 + ciphertext.byteLength;
  atom.set(KXUV_MAGIC, footerOff);
  view.setUint32(footerOff + 4, totalSize, false);
  return atom;
}

function findIsoBmffPayload(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let guard = 0;
  while (offset + 8 <= bytes.byteLength && guard < 256) {
    guard++;
    const size32 = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    let boxSize = size32;
    let headerLen = 8;
    if (size32 === 1 && offset + 16 <= bytes.byteLength) {
      boxSize = view.getUint32(offset + 8, false) * 4294967296 + view.getUint32(offset + 12, false);
      headerLen = 16;
    } else if (size32 === 0) {
      boxSize = bytes.byteLength - offset;
    }
    if (boxSize < 8 || offset + boxSize > bytes.byteLength) break;

    if (
      type === 'uuid' &&
      offset + headerLen + 24 <= bytes.byteLength &&
      bytesEqual(bytes, offset + headerLen, KX_UUID)
    ) {
      const len = view.getUint32(offset + headerLen + 16, false);
      const expectedCrc = view.getUint32(offset + headerLen + 20, false);
      const dataStart = offset + headerLen + 24;
      if (dataStart + len <= offset + boxSize) {
        const ct = bytes.subarray(dataStart, dataStart + len);
        if (crc32(ct) === expectedCrc) {
          return new Uint8Array(ct);
        }
      }
    }
    offset += boxSize;
  }
  return null;
}

function findEbmlVoidPayload(
  bytes: Uint8Array
): { ciphertext: Uint8Array; atomOffset: number } | null {
  if (bytes.byteLength < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const footerOff = bytes.byteLength - 8;
  if (!bytesEqual(bytes, footerOff, KXUV_MAGIC)) return null;

  const totalAtomSize = view.getUint32(footerOff + 4, false);
  const atomOffset = bytes.byteLength - totalAtomSize;
  if (atomOffset < 0 || atomOffset + 21 > bytes.byteLength) return null;
  if (bytes[atomOffset] !== 0xec || !bytesEqual(bytes, atomOffset + 9, KXUV_MAGIC)) return null;

  const len = view.getUint32(atomOffset + 13, false);
  const expectedCrc = view.getUint32(atomOffset + 17, false);
  const dataStart = atomOffset + 21;
  if (dataStart + len > footerOff) return null;

  const ct = bytes.subarray(dataStart, dataStart + len);
  if (crc32(ct) !== expectedCrc) return null;

  return { ciphertext: new Uint8Array(ct), atomOffset };
}

/**
 * Strips any existing KEYXERXES trailing atom before embedding a new one to keep container clean.
 */
function stripExistingKxAtom(bytes: Uint8Array, kind: VideoContainerKind): Uint8Array {
  if (kind === 'ISO-BMFF') {
    const info = inspectVideoContainer(bytes, '.mp4');
    const last = info.boxes[info.boxes.length - 1];
    if (last && last.isKeyxerxesPayload) {
      return bytes.subarray(0, last.offset);
    }
  } else {
    const found = findEbmlVoidPayload(bytes);
    if (found) {
      return bytes.subarray(0, found.atomOffset);
    }
  }
  return bytes;
}

export async function embedInVideoFile(
  videoFile: File,
  payloadInput: PayloadInput,
  cryptoOptions: EncryptOptions
): Promise<VideoEmbedResult> {
  const rawCarrier = new Uint8Array(await videoFile.arrayBuffer());
  const containerKind = detectContainerKind(rawCarrier, videoFile.name);
  const cleanCarrier = stripExistingKxAtom(rawCarrier, containerKind);

  const packed = packPayload(payloadInput);
  const { ciphertext, metrics } = await encryptBytes(packed, cryptoOptions);

  const atom =
    containerKind === 'ISO-BMFF'
      ? buildIsoBmffUuidAtom(ciphertext)
      : buildEbmlVoidAtom(ciphertext);

  const combined = new Uint8Array(cleanCarrier.byteLength + atom.byteLength);
  combined.set(cleanCarrier, 0);
  combined.set(atom, cleanCarrier.byteLength);

  const mimeType =
    videoFile.type ||
    (containerKind === 'ISO-BMFF'
      ? 'video/mp4'
      : containerKind === 'EBML-WEBM'
      ? 'video/webm'
      : 'application/octet-stream');

  const stegoBlob = new Blob([combined], { type: mimeType });
  const stegoUrl = URL.createObjectURL(stegoBlob);
  const inspection = inspectVideoContainer(combined, videoFile.name);

  const extMatch = videoFile.name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : containerKind === 'ISO-BMFF' ? '.mp4' : '.webm';
  const baseName = videoFile.name.replace(/\.[^.]+$/, '');

  return {
    stegoBlob,
    stegoUrl,
    fileName: `${baseName}_stego${ext}`,
    mimeType,
    containerKind,
    originalSize: cleanCarrier.byteLength,
    stegoSize: combined.byteLength,
    atomOverheadBytes: atom.byteLength,
    boxes: inspection.boxes,
    ciphertext,
    metrics,
  };
}

export async function extractFromVideoFile(
  videoFile: File,
  decryptOptions: DecryptOptions
): Promise<VideoExtractResult> {
  const bytes = new Uint8Array(await videoFile.arrayBuffer());
  const detectedKind = detectContainerKind(bytes, videoFile.name);

  let ciphertext = findIsoBmffPayload(bytes);
  let containerKind: VideoContainerKind = 'ISO-BMFF';

  if (!ciphertext) {
    const ebml = findEbmlVoidPayload(bytes);
    if (ebml) {
      ciphertext = ebml.ciphertext;
      containerKind = detectedKind === 'EBML-WEBM' ? 'EBML-WEBM' : 'UNIVERSAL';
    }
  }

  if (!ciphertext) {
    throw new Error(
      'NO_CONTAINER_ATOM_FOUND: No verified KEYXERXES ISO-BMFF uuid or EBML Void payload detected.'
    );
  }

  const decrypted = await decryptBytes(ciphertext, decryptOptions);
  const payload = unpackPayload(decrypted.plaintext);

  return {
    payload,
    algorithm: decrypted.algorithm,
    containerKind,
    ciphertextBytes: ciphertext.byteLength,
    elapsedMs: decrypted.elapsedMs,
  };
}
