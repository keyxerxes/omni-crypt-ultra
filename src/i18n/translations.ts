export type Lang = 'en' | 'fa';

export interface Translations {
  // Navigation
  navText: string;
  navImage: string;
  navAudio: string;
  navVideo: string;
  navCrypto: string;
  modeEmbed: string;
  modeExtract: string;

  // Cipher Config
  cipherSuite: string;
  passphrase: string;
  passphrasePlaceholder: string;
  generateKey: string;
  entropy: string;
  bits: string;
  rsaPublicKey: string;
  rsaPrivateKey: string;
  rsaGenInline: string;
  rsaGenerating: string;
  rsaFingerprint: string;
  copy: string;
  copied: string;
  download: string;
  clear: string;
  processing: string;
  ready: string;
  length: string;
  upper: string;
  lower: string;
  digits: string;
  symbols: string;

  // Payload input
  payloadType: string;
  payloadText: string;
  payloadFile: string;
  secretMessage: string;
  secretPlaceholder: string;
  selectSecretFile: string;
  dropSecretFile: string;
  capacityMeter: string;
  used: string;
  available: string;
  overflowWarning: string;

  // Text Stego
  textTitle: string;
  textSubtitle: string;
  textModeZeroWidth: string;
  textModeHomoglyph: string;
  textModeAuto: string;
  coverTextLabel: string;
  coverTextPlaceholder: string;
  loadPersianSample: string;
  loadEnglishSample: string;
  embedTextAction: string;
  extractTextAction: string;
  stegoOutputLabel: string;
  stegoInputPlaceholder: string;
  copyStegoText: string;
  loadIntoExtractor: string;
  extractedSecret: string;
  homoglyphSlots: string;
  wordBoundaries: string;
  zwCharsInjected: string;

  // Image Stego
  imageTitle: string;
  imageSubtitle: string;
  imgModeRgba2: string;
  imgModeRgb1: string;
  imgModeDct: string;
  imgModeAuto: string;
  coverImageLabel: string;
  dropCoverImage: string;
  generateSampleCover: string;
  embedImageAction: string;
  extractImageAction: string;
  downloadStegoPng: string;
  forensicInspector: string;
  viewOriginal: string;
  viewStego: string;
  viewDiff255: string;
  psnrLabel: string;
  mseLabel: string;
  modifiedPixels: string;
  maxDelta: string;
  jpegStressTitle: string;
  jpegQuality: string;
  runJpegTest: string;
  jpegSurvived: string;
  jpegDestroyed: string;
  eccCorrected: string;

  // Audio Stego
  audioTitle: string;
  audioSubtitle: string;
  coverAudioLabel: string;
  dropCoverAudio: string;
  generateSampleAudio: string;
  embedAudioAction: string;
  extractAudioAction: string;
  downloadStegoWav: string;
  sampleRate: string;
  channels: string;
  duration: string;
  snrLabel: string;
  waveformPreview: string;

  // Video Stego
  videoTitle: string;
  videoSubtitle: string;
  coverVideoLabel: string;
  dropCoverVideo: string;
  embedVideoAction: string;
  extractVideoAction: string;
  downloadStegoVideo: string;
  containerInspector: string;
  atomType: string;
  atomOffset: string;
  atomSize: string;
  containerKind: string;
  overheadBytes: string;

  // Crypto Tools
  cryptoTitle: string;
  cryptoSubtitle: string;
  toolCipher: string;
  toolRsa: string;
  toolHash: string;
  toolQr: string;
  encryptAction: string;
  decryptAction: string;
  ciphertextOutput: string;
  ciphertextInput: string;
  hashInputPlaceholder: string;
  hashOrUpload: string;
  verifyHashPlaceholder: string;
  hashMatch: string;
  hashMismatch: string;
  qrEcLevel: string;
  generateQrAction: string;
  downloadQrPng: string;
  hexPreview: string;
  operationLog: string;
  downloadExtractedFile: string;
}

export const TRANSLATIONS: Record<Lang, Translations> = {
  en: {
    navText: 'Text',
    navImage: 'Image',
    navAudio: 'Audio',
    navVideo: 'Video',
    navCrypto: 'Crypto Tools',
    modeEmbed: 'Embed / Encrypt',
    modeExtract: 'Extract / Decrypt',

    cipherSuite: 'Cipher Suite',
    passphrase: 'Master Passphrase',
    passphrasePlaceholder: 'Enter high-entropy passphrase...',
    generateKey: 'CSPRNG Generator',
    entropy: 'Entropy',
    bits: 'bits',
    rsaPublicKey: 'Recipient RSA-2048 Public Key (PEM)',
    rsaPrivateKey: 'RSA-2048 Private Key (PEM)',
    rsaGenInline: 'Generate 2048-bit Pair',
    rsaGenerating: 'Generating RSA-2048...',
    rsaFingerprint: 'SHA-256 Fingerprint',
    copy: 'Copy',
    copied: 'Copied',
    download: 'Download',
    clear: 'Clear',
    processing: 'Executing...',
    ready: 'Ready',
    length: 'Length',
    upper: 'A-Z',
    lower: 'a-z',
    digits: '0-9',
    symbols: '!@#',

    payloadType: 'Payload Input',
    payloadText: 'Secret Text',
    payloadFile: 'Binary File',
    secretMessage: 'Secret Payload',
    secretPlaceholder: 'Enter confidential text to compress, encrypt, and embed...',
    selectSecretFile: 'Select Secret File',
    dropSecretFile: 'Drop any file (.txt, .pdf, .zip, .png) or click to browse',
    capacityMeter: 'Carrier Capacity',
    used: 'Est. Payload',
    available: 'Max Capacity',
    overflowWarning: 'PAYLOAD EXCEEDS CARRIER CAPACITY',

    textTitle: 'Cover-Text Steganography',
    textSubtitle: 'DEFLATE-RAW -> Multi-Cipher AEAD -> Zero-Width Unicode or Persian/Arabic Homoglyph Carrier',
    textModeZeroWidth: 'Zero-Width Unicode',
    textModeHomoglyph: 'Persian Homoglyph',
    textModeAuto: 'Auto-Detect',
    coverTextLabel: 'Cover Text (Persian or English)',
    coverTextPlaceholder: 'Write or paste normal Persian/English text that will carry the hidden encrypted payload...',
    loadPersianSample: 'Persian Sample',
    loadEnglishSample: 'English Sample',
    embedTextAction: 'Encrypt & Inject into Text',
    extractTextAction: 'Extract & Decrypt Text',
    stegoOutputLabel: 'Steganographic Cover Text Output',
    stegoInputPlaceholder: 'Paste received steganographic text here to extract hidden payload...',
    copyStegoText: 'Copy Stego Text',
    loadIntoExtractor: 'Verify in Extractor',
    extractedSecret: 'Verified Plaintext Output',
    homoglyphSlots: 'Homoglyph Slots',
    wordBoundaries: 'Word Gaps',
    zwCharsInjected: 'ZW Chars Injected',

    imageTitle: 'High-Capacity & 2D-DCT Image Engine',
    imageSubtitle: 'Bit-Exact PNG RGBA-2bit (8 bpp), Stealth RGB-1bit, or JPEG-Resistant 2D-DCT + Hamming(7,4) ECC',
    imgModeRgba2: 'Ultra 2-bit RGBA',
    imgModeRgb1: 'Stealth 1-bit RGB',
    imgModeDct: 'Social-Shield DCT',
    imgModeAuto: 'Auto-Detect',
    coverImageLabel: 'Carrier Image',
    dropCoverImage: 'Drop PNG, JPG, or WebP cover image (or click to load)',
    generateSampleCover: 'Synthesize Test Carrier',
    embedImageAction: 'Encrypt & Embed in Image',
    extractImageAction: 'Extract & Decrypt Image',
    downloadStegoPng: 'Download Lossless PNG',
    forensicInspector: 'Forensic Diff Inspector',
    viewOriginal: 'Original',
    viewStego: 'Stego',
    viewDiff255: '255x Bit-Diff Map',
    psnrLabel: 'PSNR',
    mseLabel: 'MSE',
    modifiedPixels: 'Modified Pixels',
    maxDelta: 'Max Delta',
    jpegStressTitle: 'Simulated JPEG Compression Stress Test',
    jpegQuality: 'JPEG Quality',
    runJpegTest: 'Simulate JPEG Re-Encode',
    jpegSurvived: 'PAYLOAD SURVIVED JPEG RE-COMPRESSION',
    jpegDestroyed: 'PAYLOAD CORRUPTED BY LOSSY JPEG',
    eccCorrected: 'ECC Bit Errors Repaired',

    audioTitle: 'PCM Lossless Audio Engine',
    audioSubtitle: 'Web Audio API Decoder -> 2-bit 16-bit Stereo PCM LSB Injection -> Lossless RIFF .WAV Export',
    coverAudioLabel: 'Carrier Audio (MP3, WAV, OGG)',
    dropCoverAudio: 'Drop MP3, WAV, OGG, or FLAC audio track (or click to browse)',
    generateSampleAudio: 'Synthesize 4s Carrier WAV',
    embedAudioAction: 'Encrypt & Embed in Audio',
    extractAudioAction: 'Extract & Decrypt WAV',
    downloadStegoWav: 'Download Lossless WAV',
    sampleRate: 'Sample Rate',
    channels: 'Channels',
    duration: 'Duration',
    snrLabel: 'Signal-to-Noise',
    waveformPreview: 'PCM Waveform Monitor',

    videoTitle: 'ISO-BMFF Video & Container Engine',
    videoSubtitle: 'Zero Re-Encoding ISO-BMFF uuid Atom (.mp4/.mov) & EBML Void Element (.webm) Injection',
    coverVideoLabel: 'Carrier Video (.mp4, .webm, .mov)',
    dropCoverVideo: 'Drop MP4, WebM, MOV, or binary carrier (100% original quality preserved)',
    embedVideoAction: 'Encrypt & Append Atom',
    extractVideoAction: 'Extract & Decrypt Container',
    downloadStegoVideo: 'Download Stego Video',
    containerInspector: 'Container Atom Structure',
    atomType: 'Atom / Box',
    atomOffset: 'Byte Offset',
    atomSize: 'Size',
    containerKind: 'Container',
    overheadBytes: 'Atom Overhead',

    cryptoTitle: 'Standalone Cryptographic Workbench',
    cryptoSubtitle: 'Direct Multi-Cipher Text/File Encryption, RSA-2048 Keygen, SHA-2 Digest, and Encrypted QR Codes',
    toolCipher: 'Text / File Cipher',
    toolRsa: 'RSA-2048 Keys',
    toolHash: 'SHA-2 Hasher',
    toolQr: 'Encrypted QR',
    encryptAction: 'Encrypt Payload',
    decryptAction: 'Decrypt Ciphertext',
    ciphertextOutput: 'Authenticated KXU1 Output (Base64URL)',
    ciphertextInput: 'Encrypted KXU1 Input (Base64URL)',
    hashInputPlaceholder: 'Enter text to compute SHA-256 / SHA-384 / SHA-512 digests...',
    hashOrUpload: 'Or Hash Local File',
    verifyHashPlaceholder: 'Paste expected hash digest to verify integrity...',
    hashMatch: 'DIGEST VERIFIED: EXACT MATCH',
    hashMismatch: 'DIGEST MISMATCH',
    qrEcLevel: 'QR ECC Level',
    generateQrAction: 'Encrypt & Render QR Code',
    downloadQrPng: 'Download QR PNG',
    hexPreview: 'Ciphertext Hex Dump',
    operationLog: 'Pipeline Telemetry',
    downloadExtractedFile: 'Download Extracted File',
  },
  fa: {
    navText: 'متن',
    navImage: 'تصویر',
    navAudio: 'صوت',
    navVideo: 'ویدیو',
    navCrypto: 'ابزارهای رمزی',
    modeEmbed: 'نهان‌نگاری / رمزگذاری',
    modeExtract: 'استخراج / رمزگشایی',

    cipherSuite: 'الگوریتم رمزنگاری',
    passphrase: 'گذرواژه اصلی',
    passphrasePlaceholder: 'گذرواژه با آنتروپی بالا وارد کنید...',
    generateKey: 'تولیدکننده کلید امن',
    entropy: 'آنتروپی',
    bits: 'بیت',
    rsaPublicKey: 'کلید عمومی RSA-2048 گیرنده (PEM)',
    rsaPrivateKey: 'کلید خصوصی RSA-2048 (PEM)',
    rsaGenInline: 'تولید جفت‌کلید ۲۰۴۸ بیتی',
    rsaGenerating: 'در حال تولید RSA-2048...',
    rsaFingerprint: 'اثرانگشت SHA-256',
    copy: 'کپی',
    copied: 'کپی شد',
    download: 'دانلود',
    clear: 'پاک‌سازی',
    processing: 'در حال پردازش...',
    ready: 'آماده',
    length: 'طول',
    upper: 'A-Z',
    lower: 'a-z',
    digits: '0-9',
    symbols: '!@#',

    payloadType: 'نوع داده مخفی',
    payloadText: 'متن محرمانه',
    payloadFile: 'فایل باینری',
    secretMessage: 'پیام محرمانه',
    secretPlaceholder: 'متن محرمانه را برای فشرده‌سازی، رمزنگاری و نهان‌سازی وارد کنید...',
    selectSecretFile: 'انتخاب فایل مخفی',
    dropSecretFile: 'فایل (.txt, .pdf, .zip, .png) را اینجا رها کنید یا کلیک کنید',
    capacityMeter: 'ظرفیت حامل',
    used: 'حجم تخمینی',
    available: 'ظرفیت کل',
    overflowWarning: 'حجم داده از ظرفیت حامل بیشتر است',

    textTitle: 'نهان‌نگاری متن فارسی و چندزبانه',
    textSubtitle: 'فشرده‌سازی DEFLATE -> رمزنگاری چندلایه -> کاراکترهای نامرئی یا هم‌شکل فارسی/عربی (ک/ك و ی/ي)',
    textModeZeroWidth: 'کاراکترهای نامرئی',
    textModeHomoglyph: 'هم‌شکل فارسی/عربی',
    textModeAuto: 'تشخیص خودکار',
    coverTextLabel: 'متن پوششی (فارسی یا انگلیسی)',
    coverTextPlaceholder: 'متن عادی فارسی یا انگلیسی خود (مانند پیام، شعر یا پاراگراف) را اینجا وارد کنید...',
    loadPersianSample: 'نمونه فارسی',
    loadEnglishSample: 'نمونه انگلیسی',
    embedTextAction: 'رمزنگاری و تزریق در متن',
    extractTextAction: 'استخراج و رمزگشایی متن',
    stegoOutputLabel: 'خروجی متن نهان‌نگاری‌شده',
    stegoInputPlaceholder: 'متن حاوی پیام مخفی را اینجا جای‌گذاری کنید...',
    copyStegoText: 'کپی متن نهایی',
    loadIntoExtractor: 'تست در بخش استخراج',
    extractedSecret: 'پیام استخراج و تایید شده',
    homoglyphSlots: 'جایگاه‌های ک/ی',
    wordBoundaries: 'فاصله واژگان',
    zwCharsInjected: 'کاراکتر نامرئی',

    imageTitle: 'موتور تصویر پرظرفیت و مقاوم DCT',
    imageSubtitle: 'تزریق ۲ بیتی RGBA بدون افت، حالت مخفی ۱ بیتی RGB، و سپر تلگرام/اینستاگرام 2D-DCT + کد تصحیح خطای Hamming(7,4)',
    imgModeRgba2: 'پرظرفیت 2-bit RGBA',
    imgModeRgb1: 'مخفی 1-bit RGB',
    imgModeDct: 'سپر شبکه‌های اجتماعی DCT',
    imgModeAuto: 'تشخیص خودکار',
    coverImageLabel: 'تصویر حامل',
    dropCoverImage: 'تصویر PNG، JPG یا WebP را اینجا رها کنید یا کلیک کنید',
    generateSampleCover: 'تولید تصویر تست',
    embedImageAction: 'رمزنگاری و تزریق در تصویر',
    extractImageAction: 'استخراج و رمزگشایی تصویر',
    downloadStegoPng: 'دانلود PNG بدون افت',
    forensicInspector: 'تحلیلگر فارنزیک و نقشه اختلاف',
    viewOriginal: 'اصلی',
    viewStego: 'خروجی',
    viewDiff255: 'نقشه اختلاف ۲۵۵ برابر',
    psnrLabel: 'شاخص PSNR',
    mseLabel: 'خطای MSE',
    modifiedPixels: 'پیکسل‌های تغییر یافته',
    maxDelta: 'حداکثر تغییر کانال',
    jpegStressTitle: 'تست شبیه‌سازی فشرده‌سازی JPEG (تلگرام/واتساپ)',
    jpegQuality: 'کیفیت JPEG',
    runJpegTest: 'اجرای تست فشرده‌سازی JPEG',
    jpegSurvived: 'داده پس از فشرده‌سازی JPEG سالم ماند',
    jpegDestroyed: 'داده در اثر فشرده‌سازی مخرب JPEG آسیب دید',
    eccCorrected: 'خطای بیتی اصلاح‌شده توسط ECC',

    audioTitle: 'موتور صوتی PCM بدون افت',
    audioSubtitle: 'رمزگشایی MP3/WAV/OGG با Web Audio API -> تزریق ۲ بیتی روی نمونه‌های ۱۶ بیتی PCM -> خروجی WAV',
    coverAudioLabel: 'فایل صوتی حامل (MP3, WAV, OGG)',
    dropCoverAudio: 'فایل صوتی MP3، WAV، OGG یا FLAC را رها کنید یا کلیک کنید',
    generateSampleAudio: 'تولید صوت تست ۴ ثانیه‌ای',
    embedAudioAction: 'رمزنگاری و تزریق در صوت',
    extractAudioAction: 'استخراج و رمزگشایی WAV',
    downloadStegoWav: 'دانلود WAV بدون افت',
    sampleRate: 'نرخ نمونه‌برداری',
    channels: 'کانال‌ها',
    duration: 'مدت زمان',
    snrLabel: 'نسبت سیگنال به نویز',
    waveformPreview: 'مانیتور شکل موج PCM',

    videoTitle: 'موتور ویدیو ISO-BMFF و کانتینر جهانی',
    videoSubtitle: 'تزریق اتم uuid استاندارد ISO-BMFF (.mp4/.mov) و عنصر EBML Void (.webm) بدون نیاز به رندر مجدد',
    coverVideoLabel: 'ویدیوی حامل (.mp4, .webm, .mov)',
    dropCoverVideo: 'ویدیوی MP4، WebM یا MOV را رها کنید (حفظ ۱۰۰٪ کیفیت و سرعت اصلی)',
    embedVideoAction: 'رمزنگاری و الحاق اتم',
    extractVideoAction: 'استخراج و رمزگشایی ویدیو',
    downloadStegoVideo: 'دانلود ویدیوی خروجی',
    containerInspector: 'بازرس ساختار اتم‌های کانتینر',
    atomType: 'نوع اتم / باکس',
    atomOffset: 'آفست بایت',
    atomSize: 'اندازه',
    containerKind: 'نوع کانتینر',
    overheadBytes: 'سربار اتم',

    cryptoTitle: 'میزکار مستقل رمزنگاری',
    cryptoSubtitle: 'رمزنگاری مستقیم متن/فایل، تولید جفت‌کلید RSA-2048، هش SHA-2 و تولید کد QR رمزنگاری‌شده',
    toolCipher: 'رمزنگاری متن/فایل',
    toolRsa: 'کلیدهای RSA-2048',
    toolHash: 'مولد هش SHA-2',
    toolQr: 'کد QR رمزی',
    encryptAction: 'رمزنگاری داده',
    decryptAction: 'رمزگشایی متن رمزی',
    ciphertextOutput: 'خروجی تایید شده KXU1 (Base64URL)',
    ciphertextInput: 'ورودی رمزنگاری‌شده KXU1 (Base64URL)',
    hashInputPlaceholder: 'متن را برای محاسبه هش‌های SHA-256 / SHA-384 / SHA-512 وارد کنید...',
    hashOrUpload: 'یا محاسبه هش فایل',
    verifyHashPlaceholder: 'هش مرجع را برای تطابق و تایید اصالت وارد کنید...',
    hashMatch: 'اصالت هش تایید شد: تطابق دقیق',
    hashMismatch: 'عدم تطابق هش',
    qrEcLevel: 'سطح تصحیح خطای QR',
    generateQrAction: 'رمزنگاری و ساخت کد QR',
    downloadQrPng: 'دانلود تصویر QR',
    hexPreview: 'پیش‌نمایش هگز (Hex Dump)',
    operationLog: 'گزارش خط لوله پردازش',
    downloadExtractedFile: 'دانلود فایل استخراج‌شده',
  },
};
