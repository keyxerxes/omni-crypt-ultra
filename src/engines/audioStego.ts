/**
 * KEYXERXES // OMNI-CRYPT ULTRA — High-Capacity Audio Steganography Engine
 *
 * Decodes any uploaded audio (MP3, WAV, OGG, FLAC, M4A) via Web Audio API,
 * converts to 16-bit signed stereo PCM, embeds encrypted payloads (text or files)
 * using 2-bit PCM LSB across all audio samples, and exports a lossless RIFF .WAV file.
 * On extraction, parses raw RIFF WAV Int16 samples directly for 100% bit-exact recovery.
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

export interface LoadedAudioCarrier {
  fileName: string;
  fileSize: number;
  sampleRate: number;
  channels: number;
  durationSec: number;
  totalSamples: number;
  maxPayloadBytes: number;
  pcm16: Int16Array;
  waveformPeaks: number[];
}

export interface AudioEmbedResult {
  wavBlob: Blob;
  wavUrl: string;
  fileName: string;
  sampleRate: number;
  channels: number;
  durationSec: number;
  snrDb: number;
  ciphertext: Uint8Array;
  metrics: EncryptionMetrics;
  waveformPeaks: number[];
}

export interface AudioExtractResult {
  payload: DecodedPayload;
  algorithm: CryptoAlgorithm;
  ciphertextBytes: number;
  elapsedMs: number;
}

const AUDIO_MAGIC = [0x4b, 0x58, 0x41, 0x55]; // "KXAU"

export function extractWaveformPeaks(pcm16: Int16Array, channels: number, buckets = 160): number[] {
  const frames = Math.floor(pcm16.length / channels);
  if (frames === 0) return new Array(buckets).fill(0);
  const step = Math.max(1, Math.floor(frames / buckets));
  const peaks: number[] = [];

  for (let b = 0; b < buckets; b++) {
    const startFrame = Math.min(frames - 1, b * step);
    const endFrame = Math.min(frames, startFrame + step);
    let maxAmp = 0;
    for (let f = startFrame; f < endFrame; f += Math.max(1, Math.floor(step / 64))) {
      const val = Math.abs(pcm16[f * channels]) / 32768;
      if (val > maxAmp) maxAmp = val;
    }
    peaks.push(Number(maxAmp.toFixed(4)));
  }
  return peaks;
}

export async function decodeAudioCarrier(file: File): Promise<LoadedAudioCarrier> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('WEB_AUDIO_UNAVAILABLE: Browser does not support Web Audio API.');
  }

  const audioCtx = new AudioCtx();
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const numChannels = Math.min(2, audioBuffer.numberOfChannels);
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const totalSamples = length * numChannels;
    const pcm16 = new Int16Array(totalSamples);

    const chData: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      chData.push(audioBuffer.getChannelData(c));
    }

    // Interleave Float32 -> Signed 16-bit PCM
    let pos = 0;
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < numChannels; c++) {
        const s = Math.max(-1, Math.min(1, chData[c][i]));
        pcm16[pos++] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
      }
    }

    // 2 bits per sample => 4 samples per byte, minus 8-byte header
    const maxPayloadBytes = Math.max(0, Math.floor(totalSamples / 4) - 8);
    const waveformPeaks = extractWaveformPeaks(pcm16, numChannels, 160);

    return {
      fileName: file.name,
      fileSize: file.size,
      sampleRate,
      channels: numChannels,
      durationSec: audioBuffer.duration,
      totalSamples,
      maxPayloadBytes,
      pcm16,
      waveformPeaks,
    };
  } catch (err) {
    throw new Error(
      `AUDIO_DECODE_FAILED: Could not decode audio carrier (${err instanceof Error ? err.message : 'unsupported format'}).`
    );
  } finally {
    await audioCtx.close().catch(() => {});
  }
}

function encodePcm16ToWav(pcm16: Int16Array, sampleRate: number, channels: number): Blob {
  const dataByteLen = pcm16.byteLength;
  const buffer = new ArrayBuffer(44 + dataByteLen);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // ByteRate
  view.setUint16(32, channels * 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, dataByteLen, true);

  // Copy little-endian Int16 samples
  const dst = new Int16Array(buffer, 44, pcm16.length);
  dst.set(pcm16);

  return new Blob([buffer], { type: 'audio/wav' });
}

function parseRawWavPcm16(bytes: Uint8Array): Int16Array {
  if (bytes.byteLength < 44) {
    throw new Error('INVALID_WAV: File too small to be a valid RIFF WAVE container.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('INVALID_WAV: Expected lossless RIFF/WAVE (.wav) stego container.');
  }

  // Scan RIFF chunks to find 'fmt ' and 'data'
  let offset = 12;
  let bitsPerSample = 16;
  let audioFormat = 1;

  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );
    const size = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (id === 'fmt ' && size >= 16) {
      audioFormat = view.getUint16(chunkStart, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (id === 'data') {
      if (audioFormat !== 1 || bitsPerSample !== 16) {
        throw new Error(`UNSUPPORTED_WAV_FORMAT: Expected 16-bit PCM WAV (got format=${audioFormat}, ${bitsPerSample}-bit).`);
      }
      const actualSize = Math.min(size, bytes.byteLength - chunkStart);
      const sampleCount = Math.floor(actualSize / 2);
      const samples = new Int16Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        samples[i] = view.getInt16(chunkStart + i * 2, true);
      }
      return samples;
    }

    offset = chunkStart + size + (size % 2); // RIFF word alignment
  }

  throw new Error('INVALID_WAV: Missing PCM data chunk.');
}

export async function embedInAudio(
  carrier: LoadedAudioCarrier,
  payloadInput: PayloadInput,
  cryptoOptions: EncryptOptions
): Promise<AudioEmbedResult> {
  const packed = packPayload(payloadInput);
  const { ciphertext, metrics } = await encryptBytes(packed, cryptoOptions);

  const frame = new Uint8Array(8 + ciphertext.byteLength);
  frame.set(AUDIO_MAGIC, 0);
  new DataView(frame.buffer).setUint32(4, ciphertext.byteLength, false);
  frame.set(ciphertext, 8);

  const requiredSamples = frame.byteLength * 4;
  if (requiredSamples > carrier.pcm16.length) {
    throw new Error(
      `AUDIO_CAPACITY_EXCEEDED: Payload (${frame.byteLength} B) exceeds 2-bit PCM capacity (${carrier.maxPayloadBytes} B).`
    );
  }

  const stegoPcm = new Int16Array(carrier.pcm16);
  let signalPower = 0;
  let noisePower = 0;

  let sampleIdx = 0;
  for (let i = 0; i < frame.byteLength; i++) {
    const byte = frame[i];
    for (let shift = 6; shift >= 0; shift -= 2) {
      const twoBits = (byte >> shift) & 0x03;
      const orig = stegoPcm[sampleIdx];
      // Embed 2-bit unsigned value into 2 LSBs of 16-bit two's complement sample
      const modified = (orig & ~3) | twoBits;
      stegoPcm[sampleIdx] = modified;
      const diff = orig - modified;
      noisePower += diff * diff;
      signalPower += orig * orig;
      sampleIdx++;
    }
  }

  // Include remaining unmodified samples in signal power for accurate track SNR
  for (let i = sampleIdx; i < stegoPcm.length; i += 4) {
    signalPower += stegoPcm[i] * stegoPcm[i] * 4;
  }

  const snrDb =
    noisePower === 0
      ? 96.0
      : Number((10 * Math.log10(Math.max(1, signalPower) / noisePower)).toFixed(2));

  const wavBlob = encodePcm16ToWav(stegoPcm, carrier.sampleRate, carrier.channels);
  const wavUrl = URL.createObjectURL(wavBlob);
  const baseName = carrier.fileName.replace(/\.[^.]+$/, '');

  return {
    wavBlob,
    wavUrl,
    fileName: `${baseName}_stego.wav`,
    sampleRate: carrier.sampleRate,
    channels: carrier.channels,
    durationSec: carrier.durationSec,
    snrDb,
    ciphertext,
    metrics,
    waveformPeaks: extractWaveformPeaks(stegoPcm, carrier.channels, 160),
  };
}

export async function extractFromWavBlob(
  wavBlob: Blob,
  decryptOptions: DecryptOptions
): Promise<AudioExtractResult> {
  const bytes = new Uint8Array(await wavBlob.arrayBuffer());
  const samples = parseRawWavPcm16(bytes);

  if (samples.length < 32) {
    throw new Error('NO_AUDIO_PAYLOAD: WAV sample buffer too small.');
  }

  const readByte = (byteIdx: number): number => {
    const base = byteIdx * 4;
    return (
      ((samples[base] & 0x03) << 6) |
      ((samples[base + 1] & 0x03) << 4) |
      ((samples[base + 2] & 0x03) << 2) |
      (samples[base + 3] & 0x03)
    );
  };

  for (let m = 0; m < 4; m++) {
    if (readByte(m) !== AUDIO_MAGIC[m]) {
      throw new Error('NO_AUDIO_PAYLOAD: Missing KXAU 2-bit PCM steganography signature.');
    }
  }

  const len =
    ((readByte(4) << 24) | (readByte(5) << 16) | (readByte(6) << 8) | readByte(7)) >>> 0;
  if (len === 0 || (8 + len) * 4 > samples.length) {
    throw new Error('CORRUPT_AUDIO_PAYLOAD: Invalid embedded length header.');
  }

  const ciphertext = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    ciphertext[i] = readByte(8 + i);
  }

  const decrypted = await decryptBytes(ciphertext, decryptOptions);
  const payload = unpackPayload(decrypted.plaintext);

  return {
    payload,
    algorithm: decrypted.algorithm,
    ciphertextBytes: ciphertext.byteLength,
    elapsedMs: decrypted.elapsedMs,
  };
}

/**
 * Generates a clean, pleasant synthetic ambient chord WAV carrier directly in-browser
 * so users can test Audio Steganography instantly even without an MP3/WAV on disk.
 */
export function generateSyntheticCarrierWav(durationSec = 4): File {
  const sampleRate = 44100;
  const channels = 2;
  const frames = sampleRate * durationSec;
  const pcm16 = new Int16Array(frames * channels);
  const freqs = [220, 277.18, 329.63, 440]; // A major ambient triad

  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t * 4) * Math.min(1, (durationSec - t) * 4);
    let sampleL = 0;
    let sampleR = 0;
    for (let f = 0; f < freqs.length; f++) {
      sampleL += Math.sin(2 * Math.PI * freqs[f] * t) * 0.16;
      sampleR += Math.sin(2 * Math.PI * (freqs[f] + 0.4 * f) * t) * 0.16;
    }
    pcm16[i * 2] = Math.round(sampleL * env * 32767);
    pcm16[i * 2 + 1] = Math.round(sampleR * env * 32767);
  }

  const blob = encodePcm16ToWav(pcm16, sampleRate, channels);
  return new File([blob], 'keyxerxes_carrier_44k_stereo.wav', { type: 'audio/wav' });
}
