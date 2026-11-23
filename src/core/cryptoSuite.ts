/**
 * KEYXERXES // OMNI-CRYPT ULTRA — Multi-Algorithm Cryptographic Core
 * 100% Client-Side, Zero-Knowledge Web Crypto API + Audited RFC 8439 ChaCha20-Poly1305.
 *
 * Wire Format (Self-Describing Authenticated Envelope):
 *   [0..3]  Magic "KXU1" (0x4B, 0x58, 0x55, 0x31)
 *   [4]     Algorithm ID:
 *             0x01 = AES-256-GCM (PBKDF2-SHA256, 150,000 rounds)
 *             0x02 = ChaCha20-Poly1305 (PBKDF2-SHA256, 150,000 rounds)
 *             0x03 = Cascading Dual-Cipher (AES-256-GCM inner -> ChaCha20-Poly1305 outer)
 *             0x04 = RSA-OAEP-2048 + Ephemeral AES-256-GCM Hybrid
 *   Algorithm-specific body follows.
 */

import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { compressPayload, decompressPayload } from './compression';

export type CryptoAlgorithm =
  | 'AES-256-GCM'
  | 'CHACHA20-POLY1305'
  | 'CASCADE-AES-CHACHA'
  | 'RSA-OAEP-HYBRID';

export interface EncryptOptions {
  algorithm: CryptoAlgorithm;
  password?: string;
  rsaPublicKeyPem?: string;
  skipCompression?: boolean;
}

export interface DecryptOptions {
  password?: string;
  rsaPrivateKeyPem?: string;
  skipDecompression?: boolean;
}

export interface EncryptionMetrics {
  algorithm: CryptoAlgorithm;
  originalBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  usedCompression: boolean;
  ciphertextBytes: number;
  kdfRounds: number;
  elapsedMs: number;
}

export interface EncryptResult {
  ciphertext: Uint8Array;
  metrics: EncryptionMetrics;
}

export interface DecryptResult {
  plaintext: Uint8Array;
  algorithm: CryptoAlgorithm;
  elapsedMs: number;
}

export interface RsaKeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprintSha256: string;
}

export const PBKDF2_ITERATIONS = 150_000;

const WIRE_MAGIC = new Uint8Array([0x4b, 0x58, 0x55, 0x31]); // "KXU1"
const ALGO_TO_ID: Record<CryptoAlgorithm, number> = {
  'AES-256-GCM': 0x01,
  'CHACHA20-POLY1305': 0x02,
  'CASCADE-AES-CHACHA': 0x03,
  'RSA-OAEP-HYBRID': 0x04,
};
const ID_TO_ALGO: Record<number, CryptoAlgorithm> = {
  0x01: 'AES-256-GCM',
  0x02: 'CHACHA20-POLY1305',
  0x03: 'CASCADE-AES-CHACHA',
  0x04: 'RSA-OAEP-HYBRID',
};

const textEncoder = new TextEncoder();

function ensureSubtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WEB_CRYPTO_UNAVAILABLE: Requires HTTPS or localhost secure context.');
  }
  return crypto.subtle;
}

export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

async function derivePbkdf2Bits(
  password: string,
  salt: Uint8Array,
  bitLength: number
): Promise<Uint8Array> {
  const subtle = ensureSubtle();
  const baseKey = await subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    bitLength
  );
  return new Uint8Array(bits);
}

async function aesGcmEncryptRaw(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const subtle = ensureSubtle();
  const key = await subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const encrypted = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      ...(aad ? { additionalData: toArrayBuffer(aad) } : {}),
    },
    key,
    toArrayBuffer(plaintext)
  );
  return new Uint8Array(encrypted);
}

async function aesGcmDecryptRaw(
  keyBytes: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const subtle = ensureSubtle();
  const key = await subtle.importKey('raw', toArrayBuffer(keyBytes), { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const decrypted = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      ...(aad ? { additionalData: toArrayBuffer(aad) } : {}),
    },
    key,
    toArrayBuffer(ciphertext)
  );
  return new Uint8Array(decrypted);
}

// --- PEM Helpers for RSA-OAEP 2048-bit ---

function arrayBufferToPem(buffer: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!cleaned) {
    throw new Error('INVALID_PEM: Empty or malformed PEM key block.');
  }
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function generateRsaKeyPair(): Promise<RsaKeyPairPem> {
  const subtle = ensureSubtle();
  const keyPair = await subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );

  const spki = await subtle.exportKey('spki', keyPair.publicKey);
  const pkcs8 = await subtle.exportKey('pkcs8', keyPair.privateKey);
  const fpDigest = await subtle.digest('SHA-256', spki);
  const fingerprintSha256 = bytesToHex(new Uint8Array(fpDigest))
    .toUpperCase()
    .match(/.{1,4}/g)!
    .slice(0, 8)
    .join(':');

  return {
    publicKeyPem: arrayBufferToPem(spki, 'PUBLIC KEY'),
    privateKeyPem: arrayBufferToPem(pkcs8, 'PRIVATE KEY'),
    fingerprintSha256,
  };
}

async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const subtle = ensureSubtle();
  try {
    return await subtle.importKey(
      'spki',
      pemToArrayBuffer(pem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  } catch {
    throw new Error('INVALID_RSA_PUBLIC_KEY: Expected valid PEM SPKI Public Key.');
  }
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const subtle = ensureSubtle();
  try {
    return await subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(pem),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  } catch {
    throw new Error('INVALID_RSA_PRIVATE_KEY: Expected valid PEM PKCS#8 Private Key.');
  }
}

// --- Core Encrypt / Decrypt Pipeline ---

export async function encryptBytes(
  plaintext: Uint8Array,
  options: EncryptOptions
): Promise<EncryptResult> {
  const t0 = performance.now();
  const { algorithm, password, rsaPublicKeyPem, skipCompression } = options;

  let payloadToEncrypt: Uint8Array;
  let compressionRatio = 0;
  let usedCompression = false;

  if (skipCompression) {
    payloadToEncrypt = plaintext;
  } else {
    const comp = await compressPayload(plaintext);
    payloadToEncrypt = comp.data;
    compressionRatio = comp.ratioPercent;
    usedCompression = comp.usedCompression;
  }

  const header = new Uint8Array(5);
  header.set(WIRE_MAGIC, 0);
  header[4] = ALGO_TO_ID[algorithm];

  let body: Uint8Array;
  let kdfRounds = PBKDF2_ITERATIONS;

  if (algorithm === 'AES-256-GCM') {
    if (!password || password.length === 0) {
      throw new Error('MISSING_KEY: Passphrase is required for AES-256-GCM.');
    }
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await derivePbkdf2Bits(password, salt, 256);
    const aad = concatBytes(header, salt);
    const ct = await aesGcmEncryptRaw(key, iv, payloadToEncrypt, aad);
    body = concatBytes(salt, iv, ct);
  } else if (algorithm === 'CHACHA20-POLY1305') {
    if (!password || password.length === 0) {
      throw new Error('MISSING_KEY: Passphrase is required for ChaCha20-Poly1305.');
    }
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const key = await derivePbkdf2Bits(password, salt, 256);
    const aad = concatBytes(header, salt);
    const cipher = chacha20poly1305(key, nonce, aad);
    const ct = cipher.encrypt(payloadToEncrypt);
    body = concatBytes(salt, nonce, ct);
  } else if (algorithm === 'CASCADE-AES-CHACHA') {
    if (!password || password.length === 0) {
      throw new Error('MISSING_KEY: Passphrase is required for Cascading Dual-Cipher.');
    }
    const salt = randomBytes(16);
    const ivAes = randomBytes(12);
    const nonceChaCha = randomBytes(12);
    const masterKey = await derivePbkdf2Bits(password, salt, 512);
    const keyAes = masterKey.subarray(0, 32);
    const keyChaCha = masterKey.subarray(32, 64);

    // Layer 1 (Inner): AES-256-GCM
    const innerAad = concatBytes(header, salt, ivAes);
    const innerCt = await aesGcmEncryptRaw(keyAes, ivAes, payloadToEncrypt, innerAad);

    // Layer 2 (Outer): ChaCha20-Poly1305
    const outerAad = concatBytes(header, salt, ivAes, nonceChaCha);
    const outerCipher = chacha20poly1305(keyChaCha, nonceChaCha, outerAad);
    const outerCt = outerCipher.encrypt(innerCt);

    body = concatBytes(salt, ivAes, nonceChaCha, outerCt);
  } else if (algorithm === 'RSA-OAEP-HYBRID') {
    if (!rsaPublicKeyPem || !rsaPublicKeyPem.trim()) {
      throw new Error('MISSING_RSA_PUBLIC_KEY: Recipient RSA-2048 Public Key PEM is required.');
    }
    kdfRounds = 0;
    const subtle = ensureSubtle();
    const pubKey = await importRsaPublicKey(rsaPublicKeyPem);
    const ephemeralAesKey = randomBytes(32);
    const iv = randomBytes(12);
    const wrappedKeyBuf = await subtle.encrypt(
      { name: 'RSA-OAEP' },
      pubKey,
      toArrayBuffer(ephemeralAesKey)
    );
    const wrappedKey = new Uint8Array(wrappedKeyBuf);
    const lenPrefix = new Uint8Array(2);
    new DataView(lenPrefix.buffer).setUint16(0, wrappedKey.byteLength, false);

    const aad = concatBytes(header, lenPrefix, wrappedKey);
    const ct = await aesGcmEncryptRaw(ephemeralAesKey, iv, payloadToEncrypt, aad);
    body = concatBytes(lenPrefix, wrappedKey, iv, ct);
  } else {
    throw new Error(`UNSUPPORTED_ALGORITHM: ${algorithm}`);
  }

  const ciphertext = concatBytes(header, body);
  const elapsedMs = Number((performance.now() - t0).toFixed(1));

  return {
    ciphertext,
    metrics: {
      algorithm,
      originalBytes: plaintext.byteLength,
      compressedBytes: payloadToEncrypt.byteLength,
      compressionRatio,
      usedCompression,
      ciphertextBytes: ciphertext.byteLength,
      kdfRounds,
      elapsedMs,
    },
  };
}

export function detectWireAlgorithm(wireBytes: Uint8Array): CryptoAlgorithm | null {
  if (
    wireBytes.byteLength < 6 ||
    wireBytes[0] !== WIRE_MAGIC[0] ||
    wireBytes[1] !== WIRE_MAGIC[1] ||
    wireBytes[2] !== WIRE_MAGIC[2] ||
    wireBytes[3] !== WIRE_MAGIC[3]
  ) {
    return null;
  }
  return ID_TO_ALGO[wireBytes[4]] ?? null;
}

export async function decryptBytes(
  wireBytes: Uint8Array,
  options: DecryptOptions
): Promise<DecryptResult> {
  const t0 = performance.now();
  const algorithm = detectWireAlgorithm(wireBytes);
  if (!algorithm) {
    throw new Error('INVALID_CIPHERTEXT: Missing KXU1 authenticated header.');
  }

  const header = wireBytes.subarray(0, 5);
  const body = wireBytes.subarray(5);
  let decryptedPayload: Uint8Array;

  try {
    if (algorithm === 'AES-256-GCM') {
      if (!options.password) throw new Error('MISSING_KEY: Passphrase required.');
      if (body.byteLength < 16 + 12 + 16) throw new Error('TRUNCATED_CIPHERTEXT');
      const salt = body.subarray(0, 16);
      const iv = body.subarray(16, 28);
      const ct = body.subarray(28);
      const key = await derivePbkdf2Bits(options.password, salt, 256);
      const aad = concatBytes(header, salt);
      decryptedPayload = await aesGcmDecryptRaw(key, iv, ct, aad);
    } else if (algorithm === 'CHACHA20-POLY1305') {
      if (!options.password) throw new Error('MISSING_KEY: Passphrase required.');
      if (body.byteLength < 16 + 12 + 16) throw new Error('TRUNCATED_CIPHERTEXT');
      const salt = body.subarray(0, 16);
      const nonce = body.subarray(16, 28);
      const ct = body.subarray(28);
      const key = await derivePbkdf2Bits(options.password, salt, 256);
      const aad = concatBytes(header, salt);
      const cipher = chacha20poly1305(key, nonce, aad);
      decryptedPayload = cipher.decrypt(ct);
    } else if (algorithm === 'CASCADE-AES-CHACHA') {
      if (!options.password) throw new Error('MISSING_KEY: Passphrase required.');
      if (body.byteLength < 16 + 12 + 12 + 32) throw new Error('TRUNCATED_CIPHERTEXT');
      const salt = body.subarray(0, 16);
      const ivAes = body.subarray(16, 28);
      const nonceChaCha = body.subarray(28, 40);
      const outerCt = body.subarray(40);
      const masterKey = await derivePbkdf2Bits(options.password, salt, 512);
      const keyAes = masterKey.subarray(0, 32);
      const keyChaCha = masterKey.subarray(32, 64);

      const outerAad = concatBytes(header, salt, ivAes, nonceChaCha);
      const outerCipher = chacha20poly1305(keyChaCha, nonceChaCha, outerAad);
      const innerCt = outerCipher.decrypt(outerCt);

      const innerAad = concatBytes(header, salt, ivAes);
      decryptedPayload = await aesGcmDecryptRaw(keyAes, ivAes, innerCt, innerAad);
    } else if (algorithm === 'RSA-OAEP-HYBRID') {
      if (!options.rsaPrivateKeyPem || !options.rsaPrivateKeyPem.trim()) {
        throw new Error('MISSING_RSA_PRIVATE_KEY: RSA-2048 Private Key PEM is required.');
      }
      if (body.byteLength < 2 + 256 + 12 + 16) throw new Error('TRUNCATED_CIPHERTEXT');
      const subtle = ensureSubtle();
      const privKey = await importRsaPrivateKey(options.rsaPrivateKeyPem);
      const wrappedLen = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint16(0, false);
      if (body.byteLength < 2 + wrappedLen + 12 + 16) throw new Error('TRUNCATED_CIPHERTEXT');
      const lenPrefix = body.subarray(0, 2);
      const wrappedKey = body.subarray(2, 2 + wrappedLen);
      const iv = body.subarray(2 + wrappedLen, 2 + wrappedLen + 12);
      const ct = body.subarray(2 + wrappedLen + 12);

      const ephemeralAesKeyBuf = await subtle.decrypt(
        { name: 'RSA-OAEP' },
        privKey,
        toArrayBuffer(wrappedKey)
      );
      const ephemeralAesKey = new Uint8Array(ephemeralAesKeyBuf);
      const aad = concatBytes(header, lenPrefix, wrappedKey);
      decryptedPayload = await aesGcmDecryptRaw(ephemeralAesKey, iv, ct, aad);
    } else {
      throw new Error(`UNSUPPORTED_ALGORITHM: ${algorithm}`);
    }
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith('MISSING_') || err.message.startsWith('INVALID_RSA'))) {
      throw err;
    }
    throw new Error('AUTH_TAG_VERIFICATION_FAILED: Incorrect passphrase/key or tampered ciphertext.');
  }

  const plaintext = options.skipDecompression
    ? decryptedPayload
    : await decompressPayload(decryptedPayload);

  return {
    plaintext,
    algorithm,
    elapsedMs: Number((performance.now() - t0).toFixed(1)),
  };
}

// --- Hashing Utilities ---

export type HashAlgorithm = 'SHA-256' | 'SHA-384' | 'SHA-512';

export async function computeHashes(data: Uint8Array): Promise<Record<HashAlgorithm, string>> {
  const subtle = ensureSubtle();
  const buf = toArrayBuffer(data);
  const [h256, h384, h512] = await Promise.all([
    subtle.digest('SHA-256', buf),
    subtle.digest('SHA-384', buf),
    subtle.digest('SHA-512', buf),
  ]);
  return {
    'SHA-256': bytesToHex(new Uint8Array(h256)),
    'SHA-384': bytesToHex(new Uint8Array(h384)),
    'SHA-512': bytesToHex(new Uint8Array(h512)),
  };
}

// --- Cryptographic Password Generator & Entropy Estimator ---

export interface PasswordGenConfig {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
}

export function generateSecurePassword(config: PasswordGenConfig): string {
  const sets: string[] = [];
  if (config.uppercase) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if (config.lowercase) sets.push('abcdefghijkmnopqrstuvwxyz');
  if (config.digits) sets.push('23456789');
  if (config.symbols) sets.push('!@#$%^&*()-_=+[]{}|:,.?');
  if (sets.length === 0) sets.push('abcdefghijkmnopqrstuvwxyz23456789');

  const pool = sets.join('');
  const length = Math.max(8, Math.min(128, config.length));

  const pickUnbiased = (alphabet: string): string => {
    const maxValid = Math.floor(256 / alphabet.length) * alphabet.length;
    const buf = new Uint8Array(1);
    while (true) {
      crypto.getRandomValues(buf);
      if (buf[0] < maxValid) {
        return alphabet[buf[0] % alphabet.length];
      }
    }
  };

  // Guarantee at least one character from each enabled set
  const chars: string[] = [];
  for (const s of sets) {
    if (chars.length < length) chars.push(pickUnbiased(s));
  }
  while (chars.length < length) {
    chars.push(pickUnbiased(pool));
  }

  // Fisher-Yates CSPRNG shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const rand = new Uint32Array(1);
    crypto.getRandomValues(rand);
    const j = rand[0] % (i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

export function estimatePasswordEntropy(password: string): {
  bits: number;
  grade: 'WEAK' | 'MODERATE' | 'STRONG' | 'MILITARY';
} {
  if (!password) return { bits: 0, grade: 'WEAK' };
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^a-zA-Z0-9\u0600-\u06FF]/.test(password)) pool += 32;
  if (/[\u0600-\u06FF]/.test(password)) pool += 38;
  if (pool === 0) pool = 16;

  const bits = Math.round(password.length * Math.log2(pool));
  if (bits < 45) return { bits, grade: 'WEAK' };
  if (bits < 72) return { bits, grade: 'MODERATE' };
  if (bits < 105) return { bits, grade: 'STRONG' };
  return { bits, grade: 'MILITARY' };
}

// --- Encoding & Hex Inspection Utilities ---

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function formatHexDump(bytes: Uint8Array, maxBytes = 128): string {
  const slice = bytes.subarray(0, Math.min(bytes.byteLength, maxBytes));
  const lines: string[] = [];
  for (let i = 0; i < slice.byteLength; i += 16) {
    const addr = i.toString(16).padStart(4, '0').toUpperCase();
    const row = slice.subarray(i, i + 16);
    const hexParts: string[] = [];
    let ascii = '';
    for (let j = 0; j < 16; j++) {
      if (j < row.byteLength) {
        const b = row[j];
        hexParts.push(b.toString(16).padStart(2, '0').toUpperCase());
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      } else {
        hexParts.push('  ');
        ascii += ' ';
      }
    }
    lines.push(`${addr}  ${hexParts.slice(0, 8).join(' ')}  ${hexParts.slice(8).join(' ')}  |${ascii}|`);
  }
  if (bytes.byteLength > maxBytes) {
    lines.push(`... +${bytes.byteLength - maxBytes} bytes truncated`);
  }
  return lines.join('\n');
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64: string): Uint8Array {
  const cleaned = b64.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = cleaned.length % 4 === 0 ? '' : '='.repeat(4 - (cleaned.length % 4));
  const binary = atob(cleaned + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
