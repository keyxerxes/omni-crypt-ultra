/**
 * Native browser DEFLATE-RAW compression & decompression pipeline
 * Maximizes steganographic payload capacity prior to encryption.
 */

export interface CompressionResult {
  data: Uint8Array;
  originalSize: number;
  finalSize: number;
  ratioPercent: number;
  usedCompression: boolean;
}

const FLAG_RAW = 0x00;
const FLAG_DEFLATE_RAW = 0x01;

async function pipeStream(
  input: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const writePromise = writer.write(new Uint8Array(input)).then(() => writer.close());

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.byteLength;
    }
  }

  await writePromise;

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Compresses payload via CompressionStream('deflate-raw').
 * Prepends a 1-byte header flag: 0x01 = deflated, 0x00 = stored raw if incompressible.
 */
export async function compressPayload(input: Uint8Array): Promise<CompressionResult> {
  const originalSize = input.byteLength;

  if (typeof CompressionStream === 'undefined' || originalSize < 16) {
    const out = new Uint8Array(originalSize + 1);
    out[0] = FLAG_RAW;
    out.set(input, 1);
    return {
      data: out,
      originalSize,
      finalSize: out.byteLength,
      ratioPercent: 0,
      usedCompression: false,
    };
  }

  try {
    const deflated = await pipeStream(input, new CompressionStream('deflate-raw'));
    if (deflated.byteLength < originalSize) {
      const out = new Uint8Array(deflated.byteLength + 1);
      out[0] = FLAG_DEFLATE_RAW;
      out.set(deflated, 1);
      const ratioPercent = ((1 - deflated.byteLength / originalSize) * 100);
      return {
        data: out,
        originalSize,
        finalSize: out.byteLength,
        ratioPercent: Number(ratioPercent.toFixed(1)),
        usedCompression: true,
      };
    }
  } catch {
    // Fallback to raw storage if deflate-raw is unavailable
  }

  const out = new Uint8Array(originalSize + 1);
  out[0] = FLAG_RAW;
  out.set(input, 1);
  return {
    data: out,
    originalSize,
    finalSize: out.byteLength,
    ratioPercent: 0,
    usedCompression: false,
  };
}

/**
 * Decompresses payload framed by compressPayload().
 */
export async function decompressPayload(framed: Uint8Array): Promise<Uint8Array> {
  if (framed.byteLength < 1) {
    throw new Error('CORRUPT_PAYLOAD: Empty compressed stream.');
  }

  const flag = framed[0];
  const body = framed.subarray(1);

  if (flag === FLAG_RAW) {
    return new Uint8Array(body);
  }

  if (flag === FLAG_DEFLATE_RAW) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('UNSUPPORTED_BROWSER: DecompressionStream API unavailable.');
    }
    try {
      return await pipeStream(body, new DecompressionStream('deflate-raw'));
    } catch {
      throw new Error('DECOMPRESSION_FAILED: Invalid DEFLATE stream or corrupted carrier.');
    }
  }

  throw new Error(`INVALID_COMPRESSION_FLAG: Unrecognized stream flag 0x${flag.toString(16)}.`);
}

/**
 * Standard zlib (RFC 1950) deflate/inflate helpers used by bit-exact PNG codec.
 */
export async function zlibCompress(input: Uint8Array): Promise<Uint8Array> {
  return pipeStream(input, new CompressionStream('deflate'));
}

export async function zlibDecompress(input: Uint8Array): Promise<Uint8Array> {
  return pipeStream(input, new DecompressionStream('deflate'));
}
