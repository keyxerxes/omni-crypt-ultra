import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Download,
  FileUp,
  Image as ImageIcon,
  Layers,
  Lock,
  ScanSearch,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import { RsaKeyPairPem, formatHexDump } from '../core/cryptoSuite';
import { PayloadInput, formatBytes } from '../core/payloadFormat';
import {
  ImageEmbedResult,
  ImageExtractResult,
  ImageStegoMode,
  JpegStressResult,
  LoadedImageBuffer,
  calculateImageCapacities,
  embedInImage,
  extractFromImageBlob,
  loadImageFromBlob,
  runJpegStressTest,
} from '../engines/imageStego';
import { Translations } from '../i18n/translations';
import { CryptoConfigPanel, CryptoFormState } from './CryptoConfigPanel';
import { ExtractedPayloadView } from './ExtractedPayloadView';

interface ImageStegoModuleProps {
  t: Translations;
  cryptoState: CryptoFormState;
  onCryptoChange: (next: CryptoFormState) => void;
  sessionRsaKeys: RsaKeyPairPem | null;
  onSessionRsaKeysChange: (keys: RsaKeyPairPem) => void;
}

/**
 * Generates a high-entropy natural photographic-style test texture on canvas
 * (smooth gradients + subtle film grain + geometric structure) for immediate testing.
 */
async function synthesizeTestCarrierImage(): Promise<Blob> {
  const width = 960;
  const height = 640;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#141923');
  grad.addColorStop(0.45, '#1F2A38');
  grad.addColorStop(1, '#0F141A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Architectural geometric bands with natural tonal variation (ideal for DCT + LSB)
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = `rgba(${180 + (i % 5) * 12}, ${195 + (i % 4) * 10}, ${210}, ${0.04 + (i % 3) * 0.02})`;
    ctx.beginPath();
    ctx.arc(
      ((i * 173) % width),
      ((i * 127) % height),
      60 + (i % 6) * 28,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  // Subtle organic sensor noise across pixels
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  let seed = 1337;
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = ((seed >>> 24) & 0x0f) - 8;
    d[i] = Math.max(0, Math.min(255, d[i] + noise));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + noise));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + noise));
    d[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('SYNTHESIS_FAILED'))), 'image/png');
  });
}

export const ImageStegoModule: React.FC<ImageStegoModuleProps> = ({
  t,
  cryptoState,
  onCryptoChange,
  sessionRsaKeys,
  onSessionRsaKeysChange,
}) => {
  const [operation, setOperation] = useState<'embed' | 'extract'>('embed');
  const [mode, setMode] = useState<ImageStegoMode>('RGBA_2BIT');
  const [extractMode, setExtractMode] = useState<ImageStegoMode | 'AUTO'>('AUTO');

  const [payloadKind, setPayloadKind] = useState<'text' | 'file'>('text');
  const [secretText, setSecretText] = useState('');
  const [secretFile, setSecretFile] = useState<{ name: string; type: string; bytes: Uint8Array } | null>(null);

  const [coverImage, setCoverImage] = useState<LoadedImageBuffer | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);

  const [extractBlob, setExtractBlob] = useState<Blob | null>(null);
  const [extractFileName, setExtractFileName] = useState<string>('');
  const [extractPreviewUrl, setExtractPreviewUrl] = useState<string | null>(null);

  const [embedResult, setEmbedResult] = useState<ImageEmbedResult | null>(null);
  const [extractResult, setExtractResult] = useState<ImageExtractResult | null>(null);

  const [forensicTab, setForensicTab] = useState<'stego' | 'original' | 'diff'>('stego');
  const [jpegQuality, setJpegQuality] = useState<number>(80);
  const [jpegTesting, setJpegTesting] = useState(false);
  const [jpegResult, setJpegResult] = useState<JpegStressResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const secretFileInputRef = useRef<HTMLInputElement>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);

  // Strict ObjectURL cleanup on replacement or unmount
  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  useEffect(() => {
    return () => {
      if (extractPreviewUrl) URL.revokeObjectURL(extractPreviewUrl);
    };
  }, [extractPreviewUrl]);

  useEffect(() => {
    return () => {
      if (embedResult) {
        URL.revokeObjectURL(embedResult.stegoUrl);
        URL.revokeObjectURL(embedResult.originalAlignedUrl);
      }
    };
  }, [embedResult]);

  const capacities = useMemo(() => {
    if (!coverImage) return null;
    return calculateImageCapacities(coverImage.width, coverImage.height);
  }, [coverImage]);

  const activeMaxCapacity = useMemo(() => {
    if (!capacities) return 0;
    if (mode === 'RGBA_2BIT') return capacities.rgba2BitBytes;
    if (mode === 'RGB_1BIT') return capacities.rgb1BitBytes;
    return capacities.dctShieldBytes;
  }, [capacities, mode]);

  const rawPayloadSize = useMemo(() => {
    if (payloadKind === 'text') return new TextEncoder().encode(secretText).byteLength;
    return secretFile ? secretFile.bytes.byteLength : 0;
  }, [payloadKind, secretText, secretFile]);

  const capacityPercent =
    activeMaxCapacity > 0 ? Math.min(100, Math.round((rawPayloadSize / activeMaxCapacity) * 100)) : 0;

  const handleLoadCoverFile = async (file: File) => {
    setError(null);
    try {
      const loaded = await loadImageFromBlob(file, file.name);
      setCoverImage(loaded);
      setCoverPreviewUrl(URL.createObjectURL(file));
      setEmbedResult(null);
      setJpegResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decode cover image.');
    }
  };

  const handleSynthesizeCover = async () => {
    setError(null);
    try {
      const blob = await synthesizeTestCarrierImage();
      const file = new File([blob], 'keyxerxes_carrier_960x640.png', { type: 'image/png' });
      await handleLoadCoverFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to synthesize test carrier.');
    }
  };

  const handleLoadSecretFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setSecretFile({ name: file.name, type: file.type || 'application/octet-stream', bytes });
  };

  const handleLoadExtractFile = (file: File) => {
    setError(null);
    setExtractResult(null);
    setExtractBlob(file);
    setExtractFileName(file.name);
    setExtractPreviewUrl(URL.createObjectURL(file));
  };

  const handleEmbed = async () => {
    setError(null);
    setJpegResult(null);
    if (!coverImage) {
      setError('MISSING_CARRIER: Upload a cover image or synthesize a test carrier first.');
      return;
    }

    let payloadInput: PayloadInput;
    if (payloadKind === 'text') {
      if (!secretText) {
        setError('EMPTY_SECRET: Enter secret text to encrypt and embed.');
        return;
      }
      payloadInput = { kind: 'text', text: secretText };
    } else {
      if (!secretFile) {
        setError('EMPTY_FILE: Select a secret file to embed.');
        return;
      }
      payloadInput = {
        kind: 'file',
        fileName: secretFile.name,
        mimeType: secretFile.type,
        bytes: secretFile.bytes,
      };
    }

    setBusy(true);
    try {
      // Yield 1 frame so busy state paints smoothly before synchronous DCT/PNG math
      await new Promise((r) => setTimeout(r, 20));
      const res = await embedInImage(coverImage, payloadInput, mode, {
        algorithm: cryptoState.algorithm,
        password: cryptoState.password,
        rsaPublicKeyPem: cryptoState.rsaPublicKeyPem,
      });
      setEmbedResult(res);
      setForensicTab('stego');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image embedding failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    setError(null);
    setExtractResult(null);
    if (!extractBlob) {
      setError('MISSING_STEGO_IMAGE: Load a steganographic PNG or JPEG image to extract.');
      return;
    }

    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const res = await extractFromImageBlob(extractBlob, extractMode, {
        password: cryptoState.password,
        rsaPrivateKeyPem: cryptoState.rsaPrivateKeyPem,
      });
      setExtractResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadStego = () => {
    if (!embedResult) return;
    const a = document.createElement('a');
    a.href = embedResult.stegoUrl;
    const base = (coverImage?.fileName || 'carrier').replace(/\.[^.]+$/, '');
    a.download = `${base}_${embedResult.mode.toLowerCase()}.png`;
    a.click();
  };

  const handleSendToExtractor = () => {
    if (!embedResult) return;
    setExtractBlob(embedResult.stegoBlob);
    setExtractFileName(`verified_${embedResult.mode.toLowerCase()}.png`);
    setExtractPreviewUrl(URL.createObjectURL(embedResult.stegoBlob));
    setExtractMode('AUTO');
    setExtractResult(null);
    setError(null);
    setOperation('extract');
  };

  const handleRunJpegStress = async () => {
    if (!embedResult) return;
    setJpegTesting(true);
    setJpegResult(null);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const res = await runJpegStressTest(
        embedResult.stegoRgba,
        embedResult.width,
        embedResult.height,
        jpegQuality / 100,
        {
          password: cryptoState.password,
          rsaPrivateKeyPem: cryptoState.rsaPrivateKeyPem,
        }
      );
      setJpegResult(res);
    } finally {
      setJpegTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1E222B]">
        <div>
          <h1 className="text-base font-semibold text-[#ECEEF2] tracking-tight">{t.imageTitle}</h1>
          <p className="text-xs font-mono text-[#949BA8] mt-0.5">{t.imageSubtitle}</p>
        </div>

        <div className="inline-flex items-center p-0.5 bg-[#111318] border border-[#1E222B] rounded shrink-0 self-start md:self-auto">
          <button
            type="button"
            onClick={() => {
              setOperation('embed');
              setError(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              operation === 'embed'
                ? 'bg-[#161922] text-[#10B981] border border-[#2E3545]'
                : 'text-[#949BA8] hover:text-[#ECEEF2] border border-transparent'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            {t.modeEmbed}
          </button>
          <button
            type="button"
            onClick={() => {
              setOperation('extract');
              setError(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              operation === 'extract'
                ? 'bg-[#161922] text-[#10B981] border border-[#2E3545]'
                : 'text-[#949BA8] hover:text-[#ECEEF2] border border-transparent'
            }`}
          >
            <Unlock className="w-3.5 h-3.5" />
            {t.modeExtract}
          </button>
        </div>
      </div>

      {/* Main Split Workstation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#1E222B] rounded bg-[#111318] divide-y lg:divide-y-0 lg:divide-x divide-[#1E222B]">
        {/* Left Pane */}
        <div className="lg:col-span-6 p-5 space-y-5">
          {/* Image Engine Mode */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#949BA8] font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#10B981]" />
                Embedding Engine
              </span>
              {capacities && operation === 'embed' && (
                <span className="font-mono text-[11px] text-[#10B981] tabular-nums">
                  {t.available}: {formatBytes(activeMaxCapacity)}
                </span>
              )}
            </div>

            {operation === 'embed' ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                {(
                  [
                    ['RGBA_2BIT', t.imgModeRgba2, '8 bpp · Bit-Exact PNG'],
                    ['RGB_1BIT', t.imgModeRgb1, '3 bpp · PSNR > 55 dB'],
                    ['DCT_SHIELD', t.imgModeDct, '8x8 DCT + Hamming(7,4)'],
                  ] as const
                ).map(([id, label, spec]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    className={`p-2.5 rounded text-start border transition-colors cursor-pointer ${
                      mode === id
                        ? 'bg-[#161922] border-[#10B981] text-[#ECEEF2]'
                        : 'bg-[#090A0D] border-[#1E222B] text-[#949BA8] hover:border-[#2E3545]'
                    }`}
                  >
                    <div className="text-xs font-medium truncate">{label}</div>
                    <div className="text-[10px] font-mono text-[#5F6775] mt-0.5 truncate">
                      {spec}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {(
                  [
                    ['AUTO', t.imgModeAuto],
                    ['RGBA_2BIT', t.imgModeRgba2],
                    ['RGB_1BIT', t.imgModeRgb1],
                    ['DCT_SHIELD', t.imgModeDct],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setExtractMode(id)}
                    className={`px-2 py-2 rounded text-[11px] font-mono border transition-colors cursor-pointer truncate ${
                      extractMode === id
                        ? 'bg-[#161922] border-[#10B981] text-[#ECEEF2]'
                        : 'bg-[#090A0D] border-[#1E222B] text-[#949BA8] hover:border-[#2E3545]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[#1E222B] pt-4">
            <CryptoConfigPanel
              t={t}
              mode={operation}
              value={cryptoState}
              onChange={onCryptoChange}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={onSessionRsaKeysChange}
            />
          </div>

          {operation === 'embed' ? (
            <>
              {/* Cover Image Uploader */}
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#949BA8] font-medium">{t.coverImageLabel}</span>
                  <button
                    type="button"
                    onClick={handleSynthesizeCover}
                    className="text-[11px] font-mono text-[#10B981] hover:underline cursor-pointer"
                  >
                    {t.generateSampleCover}
                  </button>
                </div>

                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLoadCoverFile(f);
                  }}
                />

                <div
                  onClick={() => coverInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleLoadCoverFile(f);
                  }}
                  className="p-3 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer transition-colors flex items-center gap-3"
                >
                  {coverPreviewUrl && coverImage ? (
                    <>
                      <img
                        src={coverPreviewUrl}
                        alt="Cover preview"
                        className="w-16 h-12 object-cover rounded-sm border border-[#1E222B] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-mono text-[#ECEEF2] truncate">
                          {coverImage.fileName}
                        </div>
                        <div className="text-[11px] font-mono text-[#949BA8] tabular-nums mt-0.5">
                          {coverImage.width}×{coverImage.height}px · {formatBytes(coverImage.fileSize)}
                          {mode === 'DCT_SHIELD' && capacities
                            ? ` -> ${capacities.dctAlignedWidth}×${capacities.dctAlignedHeight}px`
                            : ''}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full py-3 flex flex-col items-center gap-1.5 text-center">
                      <ImageIcon className="w-5 h-5 text-[#5F6775]" />
                      <span className="text-xs text-[#949BA8]">{t.dropCoverImage}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Secret Payload: Text or Arbitrary File */}
              <div className="space-y-2.5 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-[#949BA8] font-medium">{t.payloadType}</span>
                  <div className="inline-flex bg-[#090A0D] border border-[#1E222B] rounded p-0.5">
                    <button
                      type="button"
                      onClick={() => setPayloadKind('text')}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded-sm cursor-pointer transition-colors ${
                        payloadKind === 'text'
                          ? 'bg-[#161922] text-[#10B981]'
                          : 'text-[#949BA8] hover:text-[#ECEEF2]'
                      }`}
                    >
                      {t.payloadText}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPayloadKind('file')}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded-sm cursor-pointer transition-colors ${
                        payloadKind === 'file'
                          ? 'bg-[#161922] text-[#10B981]'
                          : 'text-[#949BA8] hover:text-[#ECEEF2]'
                      }`}
                    >
                      {t.payloadFile}
                    </button>
                  </div>
                </div>

                {payloadKind === 'text' ? (
                  <textarea
                    rows={3}
                    dir="auto"
                    value={secretText}
                    onChange={(e) => setSecretText(e.target.value)}
                    placeholder={t.secretPlaceholder}
                    className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
                  />
                ) : (
                  <div>
                    <input
                      ref={secretFileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleLoadSecretFile(f);
                      }}
                    />
                    <div
                      onClick={() => secretFileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const f = e.dataTransfer.files?.[0];
                        if (f) handleLoadSecretFile(f);
                      }}
                      className="p-3.5 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer text-center transition-colors"
                    >
                      {secretFile ? (
                        <div className="text-xs font-mono text-[#10B981] tabular-nums">
                          {secretFile.name} · {formatBytes(secretFile.bytes.byteLength)}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <FileUp className="w-4 h-4 text-[#5F6775]" />
                          <span className="text-xs text-[#949BA8]">{t.dropSecretFile}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Live Capacity Meter */}
                {coverImage && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-[#949BA8]">
                        {t.capacityMeter}: {formatBytes(rawPayloadSize)} /{' '}
                        {formatBytes(activeMaxCapacity)}
                      </span>
                      <span
                        className={
                          rawPayloadSize > activeMaxCapacity ? 'text-[#F59E0B]' : 'text-[#10B981]'
                        }
                      >
                        {capacityPercent}%
                      </span>
                    </div>
                    <div className="h-1 bg-[#1E222B] rounded-sm overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          rawPayloadSize > activeMaxCapacity ? 'bg-[#F59E0B]' : 'bg-[#10B981]'
                        }`}
                        style={{ width: `${Math.min(100, capacityPercent)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleEmbed}
                disabled={busy}
                className="w-full h-10 px-4 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                {busy ? t.processing : t.embedImageAction}
              </button>
            </>
          ) : (
            <>
              {/* Extract Image Uploader */}
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <span className="text-xs text-[#949BA8] font-medium">Stego Image Carrier</span>
                <input
                  ref={extractInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLoadExtractFile(f);
                  }}
                />
                <div
                  onClick={() => extractInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleLoadExtractFile(f);
                  }}
                  className="p-4 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer transition-colors flex items-center gap-3"
                >
                  {extractPreviewUrl ? (
                    <>
                      <img
                        src={extractPreviewUrl}
                        alt="Stego carrier"
                        className="w-16 h-12 object-cover rounded-sm border border-[#1E222B] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-mono text-[#ECEEF2] truncate">
                          {extractFileName}
                        </div>
                        <div className="text-[11px] font-mono text-[#949BA8] tabular-nums">
                          {extractBlob ? formatBytes(extractBlob.size) : ''}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="w-full py-4 flex flex-col items-center gap-1.5 text-center">
                      <ImageIcon className="w-5 h-5 text-[#5F6775]" />
                      <span className="text-xs text-[#949BA8]">{t.dropCoverImage}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleExtract}
                disabled={busy}
                className="w-full h-10 px-4 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                {busy ? t.processing : t.extractImageAction}
              </button>
            </>
          )}

          {error && (
            <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded flex items-start gap-2.5 text-xs font-mono text-[#EF4444]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Right Pane: Forensic Diff Inspector & JPEG Stress Tester */}
        <div className="lg:col-span-6 p-5 bg-[#0D0F14]/60 space-y-4">
          {operation === 'embed' ? (
            embedResult ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-[#ECEEF2] flex items-center gap-1.5">
                    <ScanSearch className="w-3.5 h-3.5 text-[#10B981]" />
                    {t.forensicInspector}
                  </span>

                  <div className="inline-flex bg-[#090A0D] border border-[#1E222B] rounded p-0.5">
                    {(
                      [
                        ['original', t.viewOriginal],
                        ['stego', t.viewStego],
                        ['diff', t.viewDiff255],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setForensicTab(id)}
                        className={`px-2.5 py-1 text-[11px] font-mono rounded-sm cursor-pointer transition-colors whitespace-nowrap ${
                          forensicTab === id
                            ? 'bg-[#161922] text-[#10B981]'
                            : 'text-[#949BA8] hover:text-[#ECEEF2]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Forensic Image Viewport */}
                <div className="bg-[#090A0D] border border-[#1E222B] rounded p-2 flex items-center justify-center min-h-[220px] max-h-[300px] overflow-hidden">
                  <img
                    src={
                      forensicTab === 'original'
                        ? embedResult.originalAlignedUrl
                        : forensicTab === 'stego'
                        ? embedResult.stegoUrl
                        : embedResult.forensics.diffDataUrl
                    }
                    alt={`Forensic view: ${forensicTab}`}
                    className="max-h-[280px] max-w-full object-contain"
                  />
                </div>

                {/* Download & Verify Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadStego}
                    className="flex-1 h-9 px-3 bg-[#10B981] hover:bg-[#059669] text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.downloadStegoPng} ({formatBytes(embedResult.stegoBlob.size)})
                  </button>
                  <button
                    type="button"
                    onClick={handleSendToExtractor}
                    className="h-9 px-3 bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] text-[#ECEEF2] font-mono text-xs rounded inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 text-[#10B981]" />
                    {t.loadIntoExtractor}
                  </button>
                </div>

                {/* Quantitative Forensic Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.psnrLabel}</div>
                    <div className="text-xs font-mono font-semibold text-[#10B981] tabular-nums mt-0.5">
                      {embedResult.forensics.psnrDb} dB
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.mseLabel}</div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {embedResult.forensics.mse}
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.modifiedPixels}</div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {embedResult.forensics.modifiedPercent}%
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">COMPRESSION</div>
                    <div className="text-xs font-mono font-semibold text-[#10B981] tabular-nums mt-0.5">
                      {embedResult.metrics.usedCompression
                        ? `${embedResult.metrics.compressionRatio}%`
                        : 'RAW'}
                    </div>
                  </div>
                </div>

                {/* Simulated JPEG Compression Survival Tester */}
                <div className="p-3.5 bg-[#090A0D] border border-[#1E222B] rounded space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-medium text-[#ECEEF2]">
                      {t.jpegStressTitle}
                    </span>
                    <span className="font-mono text-[11px] text-[#10B981] tabular-nums">
                      Q = {jpegQuality}%
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={50}
                      max={95}
                      step={5}
                      value={jpegQuality}
                      onChange={(e) => setJpegQuality(Number(e.target.value))}
                      className="kx-slider flex-1"
                    />
                    <button
                      type="button"
                      onClick={handleRunJpegStress}
                      disabled={jpegTesting}
                      className="px-3 py-1.5 bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] rounded text-[11px] font-mono text-[#ECEEF2] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      {jpegTesting ? t.processing : t.runJpegTest}
                    </button>
                  </div>

                  {jpegResult && (
                    <div
                      className={`p-2.5 rounded border text-xs font-mono space-y-1 ${
                        jpegResult.survived
                          ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#10B981]'
                          : 'bg-[#F59E0B]/10 border-[#F59E0B]/40 text-[#F59E0B]'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {jpegResult.survived ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{jpegResult.survived ? t.jpegSurvived : t.jpegDestroyed}</span>
                      </div>
                      <div className="text-[11px] text-[#949BA8] tabular-nums">
                        JPEG Q={Math.round(jpegResult.quality * 100)}% ({formatBytes(jpegResult.jpegSizeBytes)})
                        {jpegResult.survived &&
                          ` · ${t.eccCorrected}: ${jpegResult.eccCorrectedErrors}`}
                      </div>
                      {jpegResult.recoveredPreview && (
                        <div className="text-[11px] text-[#ECEEF2] truncate pt-0.5">
                          RECOVERED: {jpegResult.recoveredPreview}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Hex Dump Preview */}
                <pre
                  dir="ltr"
                  className="p-2.5 bg-[#090A0D] border border-[#1E222B] rounded text-[10px] font-mono text-[#949BA8] overflow-x-auto leading-relaxed"
                >
                  {formatHexDump(embedResult.ciphertext, 64)}
                </pre>
              </div>
            ) : (
              <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1E222B] rounded space-y-2">
                <ScanSearch className="w-6 h-6 text-[#5F6775]" />
                <div className="text-xs font-mono text-[#949BA8]">
                  FORENSIC INSPECTOR STANDBY · {mode}
                </div>
                <p className="text-[11px] text-[#5F6775] max-w-sm">
                  Load or synthesize a carrier image to inspect real PSNR, MSE, 255x amplified
                  channel diff maps, and live JPEG compression resilience.
                </p>
              </div>
            )
          ) : extractResult ? (
            <div className="space-y-4">
              <ExtractedPayloadView
                t={t}
                payload={extractResult.payload}
                metaLine={`${extractResult.detectedMode} · ${extractResult.algorithm} · ${extractResult.elapsedMs} ms`}
              />
              <div className="grid grid-cols-3 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">ENGINE</div>
                  <div className="text-xs font-mono text-[#10B981] mt-0.5">
                    {extractResult.detectedMode}
                  </div>
                </div>
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">CIPHERTEXT</div>
                  <div className="text-xs font-mono text-[#ECEEF2] tabular-nums mt-0.5">
                    {formatBytes(extractResult.ciphertextBytes)}
                  </div>
                </div>
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">ECC REPAIRED</div>
                  <div className="text-xs font-mono text-[#ECEEF2] tabular-nums mt-0.5">
                    {extractResult.eccCorrectedErrors} bits
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[340px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1E222B] rounded space-y-2">
              <Unlock className="w-6 h-6 text-[#5F6775]" />
              <div className="text-xs font-mono text-[#949BA8]">IMAGE EXTRACTOR STANDBY</div>
              <p className="text-[11px] text-[#5F6775] max-w-sm">
                Upload a lossless PNG (2-bit RGBA / 1-bit RGB) or compressed JPEG (Social-Shield
                2D-DCT) to auto-detect and decrypt the hidden payload.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
