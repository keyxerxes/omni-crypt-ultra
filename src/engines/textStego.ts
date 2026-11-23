/**
 * KEYXERXES // OMNI-CRYPT ULTRA — Persian & Multilingual Cover-Text Steganography Engine
 *
 * Dual Stealth Modes:
 * 1. ZERO_WIDTH: Encodes encrypted bytes into invisible Unicode zero-width characters
 *    (\u200B, \u200C, \u200D, \uFEFF) distributed naturally after word boundaries so
 *    natural Persian ZWNJ (\u200C / نیم‌فاصله) inside words is 100% preserved and ignored.
 * 2. HOMOGLYPH: Encodes bits by alternating visually identical Persian/Arabic characters
 *    (Persian Kaf ک U+06A9 vs Arabic Kaf ك U+0643; Persian Yeh ی U+06CC vs Arabic Yeh ي U+064A)
 *    with optional Latin/Cyrillic homoglyph support for English cover texts.
 */

import {
  CryptoAlgorithm,
  DecryptOptions,
  EncryptOptions,
  EncryptionMetrics,
  decryptBytes,
  encryptBytes,
} from '../core/cryptoSuite';
import { DecodedPayload, packPayload, unpackPayload } from '../core/payloadFormat';

export type TextStegoMode = 'ZERO_WIDTH' | 'HOMOGLYPH';

export interface TextCapacityInfo {
  mode: TextStegoMode;
  wordBoundaries: number;
  persianHomoglyphSlots: number;
  latinHomoglyphSlots: number;
  totalHomoglyphBits: number;
  maxHomoglyphBytes: number;
}

export interface TextEmbedResult {
  stegoText: string;
  mode: TextStegoMode;
  ciphertext: Uint8Array;
  metrics: EncryptionMetrics;
  injectedChars: number;
  slotsUsed: number;
  slotsAvailable: number;
}

export interface TextExtractResult {
  payload: DecodedPayload;
  algorithm: CryptoAlgorithm;
  detectedMode: TextStegoMode;
  ciphertextBytes: number;
  elapsedMs: number;
}

// 4-symbol Zero-Width alphabet (2 bits per character)
const ZW_ALPHABET = ['\u200B', '\u200C', '\u200D', '\uFEFF'] as const;
const ZW_TO_BITS: Record<string, number> = {
  '\u200B': 0,
  '\u200C': 1,
  '\u200D': 2,
  '\uFEFF': 3,
};

const ZW_MAGIC_0 = 0x4b; // 'K'
const ZW_MAGIC_1 = 0x58; // 'X'

const HG_MAGIC_0 = 0xa5;
const HG_MAGIC_1 = 0x5a;

// Visually identical Persian/Arabic and Latin/Cyrillic homoglyph pairs: [bit0, bit1]
const PERSIAN_HOMOGLYPHS: Array<[string, string]> = [
  ['\u06A9', '\u0643'], // Persian Kaf (ک) vs Arabic Kaf (ك)
  ['\u06CC', '\u064A'], // Persian Yeh (ی) vs Arabic Yeh (ي)
];

const LATIN_HOMOGLYPHS: Array<[string, string]> = [
  ['a', '\u0430'], // Latin a vs Cyrillic а
  ['e', '\u0435'], // Latin e vs Cyrillic е
  ['o', '\u043E'], // Latin o vs Cyrillic о
  ['p', '\u0440'], // Latin p vs Cyrillic р
  ['c', '\u0441'], // Latin c vs Cyrillic с
  ['x', '\u0445'], // Latin x vs Cyrillic х
  ['y', '\u0443'], // Latin y vs Cyrillic у
  ['A', '\u0410'],
  ['E', '\u0415'],
  ['O', '\u041E'],
  ['P', '\u0420'],
  ['C', '\u0421'],
  ['X', '\u0425'],
];

const ZERO_MAP = new Map<string, [string, string]>();
const BIT_MAP = new Map<string, number>();
const PERSIAN_SET = new Set<string>();
const LATIN_SET = new Set<string>();

for (const pair of PERSIAN_HOMOGLYPHS) {
  ZERO_MAP.set(pair[0], pair);
  ZERO_MAP.set(pair[1], pair);
  BIT_MAP.set(pair[0], 0);
  BIT_MAP.set(pair[1], 1);
  PERSIAN_SET.add(pair[0]);
  PERSIAN_SET.add(pair[1]);
}

for (const pair of LATIN_HOMOGLYPHS) {
  ZERO_MAP.set(pair[0], pair);
  ZERO_MAP.set(pair[1], pair);
  BIT_MAP.set(pair[0], 0);
  BIT_MAP.set(pair[1], 1);
  LATIN_SET.add(pair[0]);
  LATIN_SET.add(pair[1]);
}

export function analyzeCoverTextCapacity(
  coverText: string,
  mode: TextStegoMode
): TextCapacityInfo {
  const spaceMatches = coverText.match(/[ \t\n]+/g);
  const wordBoundaries = Math.max(1, (spaceMatches?.length ?? 0) + 1);

  let persianHomoglyphSlots = 0;
  let latinHomoglyphSlots = 0;
  for (let i = 0; i < coverText.length; i++) {
    const ch = coverText[i];
    if (PERSIAN_SET.has(ch)) persianHomoglyphSlots++;
    else if (LATIN_SET.has(ch)) latinHomoglyphSlots++;
  }

  const totalHomoglyphBits = persianHomoglyphSlots + latinHomoglyphSlots;
  // 4-byte framing header (32 bits) reserved
  const maxHomoglyphBytes = Math.max(0, Math.floor((totalHomoglyphBits - 32) / 8));

  return {
    mode,
    wordBoundaries,
    persianHomoglyphSlots,
    latinHomoglyphSlots,
    totalHomoglyphBits,
    maxHomoglyphBytes,
  };
}

function bytesToZwString(bytes: Uint8Array): string {
  const chars: string[] = new Array(bytes.byteLength * 4);
  let pos = 0;
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    chars[pos++] = ZW_ALPHABET[(b >> 6) & 0x03];
    chars[pos++] = ZW_ALPHABET[(b >> 4) & 0x03];
    chars[pos++] = ZW_ALPHABET[(b >> 2) & 0x03];
    chars[pos++] = ZW_ALPHABET[b & 0x03];
  }
  return chars.join('');
}

function zwCharsToBytes(zwChars: string[]): Uint8Array {
  const byteCount = Math.floor(zwChars.length / 4);
  const out = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const b0 = ZW_TO_BITS[zwChars[i * 4]];
    const b1 = ZW_TO_BITS[zwChars[i * 4 + 1]];
    const b2 = ZW_TO_BITS[zwChars[i * 4 + 2]];
    const b3 = ZW_TO_BITS[zwChars[i * 4 + 3]];
    out[i] = (b0 << 6) | (b1 << 4) | (b2 << 2) | b3;
  }
  return out;
}

/**
 * Strips any previously injected boundary ZW runs while preserving natural mid-word Persian ZWNJs.
 */
function cleanBoundaryZeroWidth(text: string): string {
  // Remove ZW runs at start of text, immediately after whitespace, or at end of text
  return text
    .replace(/^[\u200B\u200C\u200D\uFEFF]+/, '')
    .replace(/([ \t\r\n])[\u200B\u200C\u200D\uFEFF]+/g, '$1')
    .replace(/[\u200B\u200C\u200D\uFEFF]+$/, '');
}

function injectZeroWidth(coverText: string, ciphertext: Uint8Array): { text: string; injectedChars: number; slots: number } {
  const cleaned = cleanBoundaryZeroWidth(coverText);
  if (!cleaned.trim()) {
    throw new Error('EMPTY_COVER_TEXT: Please provide a non-empty cover text.');
  }

  // Frame: [Magic 2B][Length 2B BE][Ciphertext]
  if (ciphertext.byteLength > 65535) {
    throw new Error('PAYLOAD_TOO_LARGE: Text steganography supports up to 65,535 encrypted bytes.');
  }
  const framed = new Uint8Array(4 + ciphertext.byteLength);
  framed[0] = ZW_MAGIC_0;
  framed[1] = ZW_MAGIC_1;
  framed[2] = (ciphertext.byteLength >> 8) & 0xff;
  framed[3] = ciphertext.byteLength & 0xff;
  framed.set(ciphertext, 4);

  const zwPayload = bytesToZwString(framed);

  // Split cover text preserving whitespace separators so we inject right after spaces
  const tokens = cleaned.split(/([ \t\r\n]+)/);
  const spaceIndices: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 1 && tokens[i].length > 0) {
      spaceIndices.push(i);
    }
  }

  if (spaceIndices.length === 0) {
    // No spaces in cover text: append cleanly at end
    return {
      text: cleaned + zwPayload,
      injectedChars: zwPayload.length,
      slots: 1,
    };
  }

  // Distribute zwPayload evenly across word-boundary whitespace slots
  const slotCount = spaceIndices.length;
  const baseChunk = Math.floor(zwPayload.length / slotCount);
  const remainder = zwPayload.length % slotCount;

  let cursor = 0;
  for (let s = 0; s < slotCount; s++) {
    const chunkLen = baseChunk + (s < remainder ? 1 : 0);
    if (chunkLen > 0) {
      const slice = zwPayload.slice(cursor, cursor + chunkLen);
      cursor += chunkLen;
      tokens[spaceIndices[s]] = tokens[spaceIndices[s]] + slice;
    }
  }

  return {
    text: tokens.join(''),
    injectedChars: zwPayload.length,
    slots: slotCount,
  };
}

function extractZeroWidthBytes(stegoText: string): Uint8Array | null {
  const collected: string[] = [];
  const isWhitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

  let i = 0;
  while (i < stegoText.length) {
    const ch = stegoText[i];
    if (ch in ZW_TO_BITS) {
      // Check if this ZW run starts at index 0, right after whitespace, or reaches end-of-string
      const prevIsBoundary = i === 0 || isWhitespace(stegoText[i - 1]);
      let end = i;
      while (end < stegoText.length && stegoText[end] in ZW_TO_BITS) {
        end++;
      }
      const reachesEnd = end === stegoText.length;

      // Natural Persian ZWNJ (\u200C) is a single character flanked by non-whitespace letters
      if (prevIsBoundary || reachesEnd) {
        for (let k = i; k < end; k++) {
          collected.push(stegoText[k]);
        }
      }
      i = end;
    } else {
      i++;
    }
  }

  if (collected.length < 16) return null; // At least 4 header bytes
  const bytes = zwCharsToBytes(collected);
  if (bytes.byteLength < 4 || bytes[0] !== ZW_MAGIC_0 || bytes[1] !== ZW_MAGIC_1) {
    return null;
  }

  const len = (bytes[2] << 8) | bytes[3];
  if (len === 0 || bytes.byteLength < 4 + len) {
    return null;
  }
  return bytes.subarray(4, 4 + len);
}

function injectHomoglyphs(
  coverText: string,
  ciphertext: Uint8Array
): { text: string; slotsUsed: number; slotsAvailable: number } {
  if (!coverText.trim()) {
    throw new Error('EMPTY_COVER_TEXT: Please provide a non-empty cover text.');
  }
  if (ciphertext.byteLength > 65535) {
    throw new Error('PAYLOAD_TOO_LARGE: Exceeds 16-bit frame limit.');
  }

  const framed = new Uint8Array(4 + ciphertext.byteLength);
  framed[0] = HG_MAGIC_0;
  framed[1] = HG_MAGIC_1;
  framed[2] = (ciphertext.byteLength >> 8) & 0xff;
  framed[3] = ciphertext.byteLength & 0xff;
  framed.set(ciphertext, 4);

  const requiredBits = framed.byteLength * 8;
  const slots: number[] = [];
  for (let i = 0; i < coverText.length; i++) {
    if (ZERO_MAP.has(coverText[i])) {
      slots.push(i);
    }
  }

  if (slots.length < requiredBits) {
    const neededBytes = Math.ceil((requiredBits - slots.length) / 8);
    throw new Error(
      `INSUFFICIENT_HOMOGLYPH_CAPACITY: Cover text has ${slots.length} substitutable characters (${Math.max(0, Math.floor((slots.length - 32) / 8))} B), but encrypted payload requires ${requiredBits} bits (${ciphertext.byteLength} B). Add ~${neededBytes * 8} more Persian ک/ی (or Latin) characters.`
    );
  }

  const chars = Array.from(coverText);
  let bitIndex = 0;
  for (let s = 0; s < slots.length; s++) {
    const pos = slots[s];
    const pair = ZERO_MAP.get(chars[pos])!;
    if (bitIndex < requiredBits) {
      const byteIdx = bitIndex >> 3;
      const bitPos = 7 - (bitIndex & 7);
      const bit = (framed[byteIdx] >> bitPos) & 1;
      chars[pos] = pair[bit];
      bitIndex++;
    } else {
      // Normalize remaining carrier characters to clean canonical Persian/Latin (bit 0)
      chars[pos] = pair[0];
    }
  }

  return {
    text: chars.join(''),
    slotsUsed: requiredBits,
    slotsAvailable: slots.length,
  };
}

function extractHomoglyphBytes(stegoText: string): Uint8Array | null {
  const bits: number[] = [];
  for (let i = 0; i < stegoText.length; i++) {
    const bit = BIT_MAP.get(stegoText[i]);
    if (bit !== undefined) {
      bits.push(bit);
    }
  }

  if (bits.length < 32) return null;

  const readByte = (byteIdx: number): number => {
    let val = 0;
    const base = byteIdx * 8;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | bits[base + b];
    }
    return val;
  };

  if (readByte(0) !== HG_MAGIC_0 || readByte(1) !== HG_MAGIC_1) {
    return null;
  }

  const payloadLen = (readByte(2) << 8) | readByte(3);
  if (payloadLen === 0 || (4 + payloadLen) * 8 > bits.length) {
    return null;
  }

  const out = new Uint8Array(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    out[i] = readByte(4 + i);
  }
  return out;
}

// --- Public High-Level API ---

export async function embedInCoverText(
  coverText: string,
  secretMessage: string,
  mode: TextStegoMode,
  cryptoOptions: EncryptOptions
): Promise<TextEmbedResult> {
  if (!secretMessage) {
    throw new Error('EMPTY_SECRET: Enter a secret message to encrypt and embed.');
  }

  const packed = packPayload({ kind: 'text', text: secretMessage });
  const { ciphertext, metrics } = await encryptBytes(packed, cryptoOptions);

  if (mode === 'ZERO_WIDTH') {
    const res = injectZeroWidth(coverText, ciphertext);
    return {
      stegoText: res.text,
      mode,
      ciphertext,
      metrics,
      injectedChars: res.injectedChars,
      slotsUsed: res.slots,
      slotsAvailable: res.slots,
    };
  }

  const res = injectHomoglyphs(coverText, ciphertext);
  return {
    stegoText: res.text,
    mode,
    ciphertext,
    metrics,
    injectedChars: 0,
    slotsUsed: res.slotsUsed,
    slotsAvailable: res.slotsAvailable,
  };
}

export async function extractFromCoverText(
  stegoText: string,
  preferredMode: TextStegoMode | 'AUTO',
  decryptOptions: DecryptOptions
): Promise<TextExtractResult> {
  if (!stegoText.trim()) {
    throw new Error('EMPTY_STEGO_TEXT: Paste a steganographic cover text to extract.');
  }

  let detectedMode: TextStegoMode | null = null;
  let cipherBytes: Uint8Array | null = null;

  if (preferredMode === 'ZERO_WIDTH' || preferredMode === 'AUTO') {
    cipherBytes = extractZeroWidthBytes(stegoText);
    if (cipherBytes) detectedMode = 'ZERO_WIDTH';
  }

  if (!cipherBytes && (preferredMode === 'HOMOGLYPH' || preferredMode === 'AUTO')) {
    cipherBytes = extractHomoglyphBytes(stegoText);
    if (cipherBytes) detectedMode = 'HOMOGLYPH';
  }

  if (!cipherBytes || !detectedMode) {
    throw new Error(
      'NO_STEGO_SIGNATURE_FOUND: No Zero-Width or Persian/Arabic Homoglyph carrier header detected in this text.'
    );
  }

  const decrypted = await decryptBytes(cipherBytes, decryptOptions);
  const payload = unpackPayload(decrypted.plaintext);

  return {
    payload,
    algorithm: decrypted.algorithm,
    detectedMode,
    ciphertextBytes: cipherBytes.byteLength,
    elapsedMs: decrypted.elapsedMs,
  };
}

// High-density Persian sample cover text (~1000+ ک/ی slots = >120 B encrypted Homoglyph capacity)
export const SAMPLE_PERSIAN_COVER = `در یکی از شب‌های آرام و بارانی پاییزی، کتابی قدیمی و بسیار ارزشمند از کتابخانه مرکزی شهر پیدا کردم که در آن نکات دقیق و علمی درباره معماری ایرانی، کاشی‌کاری فیروزه‌ای، هندسه کلاسیک و زیبایی‌شناسی رنگ‌ها نوشته شده بود. هر صفحه‌ای که با کنجکاوی ورق می‌زدم، تصویری تازه از هنر اصیل و ظرافت بی‌نظیر معماران گذشته در ذهنم شکل می‌گرفت. این کتاب قدیمی یادآور این حقیقت روشن است که دانش واقعی و آگاهی عمیق، مانند نوری ماندگار در تاریکی زمان می‌درخشد و هیچ‌گاه خاموش نمی‌شود. بسیاری از پژوهشگران، نویسندگان و تاریخ‌نگاران برجسته نیز بر این باورند که حفظ میراث فرهنگی و علمی، یکی از مهم‌ترین مسئولیت‌های نسل کنونی در برابر آیندگان است. زیبایی، سادگی، هماهنگی و دقت در جزئیات، کلید درک این آثار ارزشمند و بی‌بدیل در سراسر جهان محسوب می‌شود.

وقتی با دقت و تمرکز بیشتری به نقش‌های اسلیمی، گره‌چینی‌های آجری و کتیبه‌های تاریخی نگاه می‌کنیم، درمی‌یابیم که هر خط، هر زاویه و هر منحنی بر پایه محاسبات دقیق ریاضی و هندسی طراحی و اجرا شده است. در کنار این هنرهای دیداری و معماری شگفت‌انگیز، ادبیات و شعر کلاسیک فارسی نیز با کلمات آهنگین، ترکیب‌های خلاقانه و معانی عمیق انسانی، پیوندی ناگسستنی با فرهنگ و اندیشه این سرزمین برقرار کرده است. یکی از ویژگی‌های کلیدی این سبک نوشتاری، ایجاز، شفافیت و انتقال مفاهیم پیچیده فلسفی و علمی در قالب جملاتی ساده، روان و صمیمی است که برای هر خواننده‌ای ملموس، خواندنی و دلنشین به نظر می‌رسد. کتابخانه‌های تاریخی در شهرهای گوناگون، گنجینه‌ای غنی از نسخه‌های خطی، رساله‌های نجومی و یادداشت‌های پزشکی را در دل خود نگهداری می‌کنند.

در بخش دیگری از این کتاب کهنه و خواندنی، نویسنده به بررسی ابزارهای اندازه‌گیری دقیق، اسطرلاب‌های برنجی، ساعت‌های آبی و شیوه‌های محاسبه تقویم خورشیدی پرداخته است. دانشمندان ایرانی در سده‌های پیشین با تکیه بر مشاهده مستقیم، آزمایش‌های پیوسته و ثبت دقیق داده‌های رصدی، پایه‌گذار روش‌های علمی نوینی شدند که تا سده‌ها در دانشگاه‌ها و مراکز علمی شرق و غرب تدریس می‌شد. یکی از نکات بسیار جالب این فصل، شرح همکاری نزدیک میان ریاضی‌دانان، صنعتگران فلزکار و خوشنویسان برای ساخت ابزارهایی بود که هم کارایی فنی فوق‌العاده‌ای داشتند و هم از نظر زیبایی بصری در اوج کمال بودند. چنین پیوندی میان علم و هنر، الگویی الهام‌بخش برای مهندسان و طراحان امروزی به شمار می‌آید.

امروزه نیز در دنیای فناوری اطلاعات، امنیت سایبری و مهندسی نرم‌افزار، همین اصل بنیادین یعنی ترکیب دقت ریاضی با طراحی تمیز و کاربردی، اهمیت کلیدی دارد. مهندسان با بررسی الگوهای پیچیده، الگوریتم‌های رمزنگاری مدرن و ساختارهای داده‌ای بهینه، سیستم‌هایی خلق می‌کنند که حریم خصوصی کاربران را در برابر تهدیدهای گوناگون محافظت می‌کند. هر سیستم امنیتی کارآمد باید بر پایه استانداردهای شفاف، کدنویسی تمیز و بررسی‌های مستقل فنی ساخته شود تا در شرایط واقعی عملکردی بی‌نقص و قابل اعتماد ارائه دهد. مطالعه دقیق تاریخ علم به ما یادآوری می‌کند که خلاقیت پایدار همیشه از کنجکاوی عمیق، صبر علمی و توجه بی‌وقفه به جزئیات کلیدی سرچشمه می‌گیرد.

در فصل پایانی این اثر ارزشمند، مجموعه‌ای از یادداشت‌های سفرنامه‌ای درباره کاروانسراهای کویری، بادگیرهای هوشمند و قنات‌های چندصدساله گردآوری شده است. این سازه‌های شگفت‌انگیز نشان می‌دهند که چگونه مهندسان گذشته با درک عمیق اقلیم، جریان باد و فیزیک انتقال گرما، بدون مصرف انرژی فسیلی، فضاهایی خنک، آرام و پایدار برای زندگی و استراحت مسافران پدید می‌آوردند. یکی از شگفتی‌های معماری کویری، استفاده هوشمندانه از مصالح بومی مانند خشت، گل و آجر پخته است که در گرمای سوزان تابستان و سرمای خشک زمستان، تعادل دمایی چشمگیری ایجاد می‌کند. یادگیری از این راهکارهای بومی و ترکیب آن‌ها با دانش فنی معاصر می‌تواند مسیر تازه‌ای برای طراحی شهرهای پایدار، کم‌مصرف و هماهنگ با طبیعت در دهه‌های آینده بگشاید.

در حاشیه صفحات پایانی کتاب نیز یادداشت‌های کوتاهی با مرکب مشکی درباره موسیقی سنتی ایرانی، دستگاه‌های آوازی، کوک سازهای زهی و پیوند ریاضی میان فواصل موسیقایی نوشته شده بود. نویسنده با بیانی ساده و فنی توضیح داده بود که چگونه یک نوازنده چیره‌دست با تکیه بر گوش دقیق، تمرین مداوم و شناخت عمیق ردیف‌های کلاسیک می‌تواند در هر اجرایی حالتی یگانه و تکرارنشدنی خلق کند. همین ظرافت در ساخت سازهای چوبی مانند تار، سه‌تار، کمانچه و سنتور نیز به چشم می‌خورد؛ جایی که انتخاب چوب توت کهنه، ضخامت صفحه رویی و تراش دقیق کاسه طنینی، کیفیت نهایی صدا را تعیین می‌کند.

نگاهی به تاریخ کتاب‌سازی، صحافی سنتی، تذهیب و کاغذسازی در کارگاه‌های قدیمی نشان می‌دهد که صنعتگران برای تولید یک نسخه ماندگار چه دقت و حوصله‌ای به خرج می‌دادند. از آماده‌سازی الیاف طبیعی و آهار زدن کاغذ گرفته تا ساخت رنگدانه‌های معدنی لاجوردی و شنگرفی، هر مرحله با کیفیتی کم‌نظیر انجام می‌شد تا نوشته‌ها پس از گذشت چند سده همچنان خوانا، روشن و سالم باقی بمانند. بسیاری از موزه‌ها و مراکز پژوهشی بین‌المللی امروزه با بهره‌گیری از فناوری‌های تصویربرداری دیجیتال و تحلیل طیفی، ساختار شیمیایی این جوهرها و کاغذهای کهن را بررسی می‌کنند تا روش‌های نگهداری علمی و دقیق‌تری برای اسناد تاریخی تدوین کنند.

در نهایت، مرور این مجموعه گسترده از دانش‌های گوناگون از معماری و نجوم گرفته تا موسیقی، کتاب‌آرایی و مهندسی مدرن، این پیام روشن را در ذهن زنده می‌کند که تمدن انسانی بر دوش گفت‌وگوی پیوسته نسل‌ها بنا شده است. هر کتابی که با دقت خوانده می‌شود، هر طرحی که با وسواس علمی اصلاح می‌گردد و هر ایده‌ای که با صداقت و شفافیت به اشتراک گذاشته می‌شود، حلقه‌ای تازه به این زنجیره دیرینه می‌افزاید. امید می‌رود نسل‌های آینده نیز با همین اشتیاق علمی، دقت فنی و روحیه کنجکاوی، مسیر کشف، نوآوری و ساخت ابزارهای کارآمد و ایمن را با قدرت بیشتری ادامه دهند.

در کنار این پژوهش‌های تاریخی و فنی، بررسی شیوه‌های آموزش علمی و انتقال تجربه در کارگاه‌های کهن نیز بسیار آموزنده است. شاگردان در کنار استادکاران باتجربه نه تنها اصول نظری، بلکه مهارت‌های عملی، انضباط کاری و دقت در اندازه‌گیری را گام به گام فرا می‌گرفتند. این پیوند نزدیک میان نظریه و عمل باعث می‌شد هر نوآوری تازه‌ای بلافاصله در میدان واقعی آزمایش شود، کاستی‌های احتمالی آن شناسایی گردد و نسخه‌ای پخته‌تر و قابل اتکاتر جایگزین آن شود. بسیاری از کلیدی‌ترین پیشرفت‌های مهندسی امروز نیز دقیقاً از همین چرخه پیوسته طراحی، آزمایش، بازبینی دقیق و بهبود مداوم به دست می‌آید.`;

export const SAMPLE_ENGLISH_COVER = `During the late autumn symposium on architectural acoustics and classical geometry, researchers examined archival manuscripts describing precision masonry, proportional harmony, and spatial resonance across historic courtyards. Every documented schematic revealed an extraordinary level of mathematical clarity, balancing practical structural economy with enduring visual grace. Contemporary engineers studying these historical notebooks often remark that genuine elegance emerges when complexity is refined into clear, repeatable principles. Across libraries and conservation laboratories, specialists continue to catalogue fragile folios, verify pigment chemistry, and preserve fragile ink drawings for future generations.

In the second volume of the archive, contributors analyzed brass astrolabes, hydraulic timekeepers, and solar calendars crafted by master instrument makers. Each calibrated dial combined fine metallurgical tolerances with legible engravings, allowing navigators and astronomers to record planetary positions with remarkable consistency across long voyages. Careful inspection of surviving artifacts shows that scientific precision and disciplined craft were never treated as separate domains; rather, each reinforced the other through continuous empirical testing, meticulous record keeping, and open scholarly correspondence across distant observatories.

Modern systems engineering inherits the same foundational commitment to transparency, auditability, and resilience under real-world operational stress. Whether designing cryptographic protocols, fault-tolerant storage pipelines, or deterministic signal encoders, senior practitioners emphasize verifiable invariants over opaque complexity. Carefully observing each measured proportion, clean boundary, and reproducible benchmark demonstrates how patient engineering transcends passing trends and preserves institutional reliability across decades of continuous technical evolution.

Further chapters in the archival series document traditional cartography, optical lens grinding, and acoustic chamber calibration across coastal workshops. Artisans tested glass purity under angled sunlight, polished parabolic reflectors by hand, and recorded angular deviations in structured tabular ledgers. By combining repeatable experimental protocols with clear visual notation, workshop teams established shared standards that enabled independent laboratories across regions to replicate instruments accurately, diagnose subtle manufacturing tolerances, and collaborate cleanly across generations of scientific progress and open technical inquiry.`;
