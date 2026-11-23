/**
 * Unified binary payload envelope for text messages and arbitrary files.
 * Layout:
 *   [0..1]   Magic "KX" (0x4B, 0x58)
 *   [2]      Kind: 0x01 = UTF-8 Text, 0x02 = Binary File
 *   If Text:
 *     [3..]  UTF-8 encoded string bytes
 *   If File:
 *     [3..4] Filename byte length (uint16 BE)
 *     [5..6] MIME type byte length (uint16 BE)
 *     [7..]  Filename UTF-8 + MIME UTF-8 + raw file bytes
 */

export type PayloadInput =
  | { kind: 'text'; text: string }
  | { kind: 'file'; fileName: string; mimeType: string; bytes: Uint8Array };

export type DecodedPayload =
  | { kind: 'text'; text: string; byteLength: number }
  | { kind: 'file'; fileName: string; mimeType: string; bytes: Uint8Array; byteLength: number };

const MAGIC_0 = 0x4b; // 'K'
const MAGIC_1 = 0x58; // 'X'
const KIND_TEXT = 0x01;
const KIND_FILE = 0x02;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

export function packPayload(input: PayloadInput): Uint8Array {
  if (input.kind === 'text') {
    const textBytes = textEncoder.encode(input.text);
    const out = new Uint8Array(3 + textBytes.byteLength);
    out[0] = MAGIC_0;
    out[1] = MAGIC_1;
    out[2] = KIND_TEXT;
    out.set(textBytes, 3);
    return out;
  }

  const nameBytes = textEncoder.encode(input.fileName || 'extracted.bin');
  const mimeBytes = textEncoder.encode(input.mimeType || 'application/octet-stream');
  if (nameBytes.byteLength > 65535 || mimeBytes.byteLength > 65535) {
    throw new Error('PAYLOAD_METADATA_OVERFLOW: Filename or MIME exceeds 64KB.');
  }

  const out = new Uint8Array(7 + nameBytes.byteLength + mimeBytes.byteLength + input.bytes.byteLength);
  const view = new DataView(out.buffer);
  out[0] = MAGIC_0;
  out[1] = MAGIC_1;
  out[2] = KIND_FILE;
  view.setUint16(3, nameBytes.byteLength, false);
  view.setUint16(5, mimeBytes.byteLength, false);

  let offset = 7;
  out.set(nameBytes, offset);
  offset += nameBytes.byteLength;
  out.set(mimeBytes, offset);
  offset += mimeBytes.byteLength;
  out.set(input.bytes, offset);
  return out;
}

export function unpackPayload(raw: Uint8Array): DecodedPayload {
  if (raw.byteLength < 3 || raw[0] !== MAGIC_0 || raw[1] !== MAGIC_1) {
    throw new Error('INVALID_ENVELOPE: Decrypted data is not a valid KEYXERXES payload.');
  }

  const kind = raw[2];
  if (kind === KIND_TEXT) {
    const textBytes = raw.subarray(3);
    return {
      kind: 'text',
      text: textDecoder.decode(textBytes),
      byteLength: textBytes.byteLength,
    };
  }

  if (kind === KIND_FILE) {
    if (raw.byteLength < 7) {
      throw new Error('CORRUPT_FILE_ENVELOPE: Truncated file header.');
    }
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nameLen = view.getUint16(3, false);
    const mimeLen = view.getUint16(5, false);
    const headerEnd = 7 + nameLen + mimeLen;
    if (raw.byteLength < headerEnd) {
      throw new Error('CORRUPT_FILE_ENVELOPE: Truncated metadata block.');
    }
    const fileName = textDecoder.decode(raw.subarray(7, 7 + nameLen));
    const mimeType = textDecoder.decode(raw.subarray(7 + nameLen, headerEnd));
    const fileBytes = new Uint8Array(raw.subarray(headerEnd));
    return {
      kind: 'file',
      fileName: fileName || 'extracted.bin',
      mimeType: mimeType || 'application/octet-stream',
      bytes: fileBytes,
      byteLength: fileBytes.byteLength,
    };
  }

  throw new Error(`UNKNOWN_PAYLOAD_KIND: 0x${kind.toString(16)}`);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
