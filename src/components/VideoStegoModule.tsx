import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Boxes,
  Download,
  FileUp,
  Film,
  Lock,
  Unlock,
} from 'lucide-react';
import { RsaKeyPairPem, formatHexDump } from '../core/cryptoSuite';
import { PayloadInput, formatBytes } from '../core/payloadFormat';
import {
  VideoEmbedResult,
  VideoExtractResult,
  VideoInspectionResult,
  embedInVideoFile,
  extractFromVideoFile,
  inspectVideoContainer,
} from '../engines/videoStego';
import { Translations } from '../i18n/translations';
import { CryptoConfigPanel, CryptoFormState } from './CryptoConfigPanel';
import { ExtractedPayloadView } from './ExtractedPayloadView';

interface VideoStegoModuleProps {
  t: Translations;
  cryptoState: CryptoFormState;
  onCryptoChange: (next: CryptoFormState) => void;
  sessionRsaKeys: RsaKeyPairPem | null;
  onSessionRsaKeysChange: (keys: RsaKeyPairPem) => void;
}

export const VideoStegoModule: React.FC<VideoStegoModuleProps> = ({
  t,
  cryptoState,
  onCryptoChange,
  sessionRsaKeys,
  onSessionRsaKeysChange,
}) => {
  const [operation, setOperation] = useState<'embed' | 'extract'>('embed');
  const [payloadKind, setPayloadKind] = useState<'text' | 'file'>('text');
  const [secretText, setSecretText] = useState('');
  const [secretFile, setSecretFile] = useState<{ name: string; type: string; bytes: Uint8Array } | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoInspection, setVideoInspection] = useState<VideoInspectionResult | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  const [extractFile, setExtractFile] = useState<File | null>(null);
  const [extractInspection, setExtractInspection] = useState<VideoInspectionResult | null>(null);

  const [embedResult, setEmbedResult] = useState<VideoEmbedResult | null>(null);
  const [extractResult, setExtractResult] = useState<VideoExtractResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const secretFileInputRef = useRef<HTMLInputElement>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  useEffect(() => {
    return () => {
      if (embedResult) URL.revokeObjectURL(embedResult.stegoUrl);
    };
  }, [embedResult]);

  const handleLoadVideoCarrier = async (file: File) => {
    setError(null);
    setEmbedResult(null);
    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setVideoInspection(inspectVideoContainer(bytes, file.name));
    } catch {
      setVideoInspection(null);
    }
  };

  const handleLoadExtractVideo = async (file: File) => {
    setError(null);
    setExtractResult(null);
    setExtractFile(file);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setExtractInspection(inspectVideoContainer(bytes, file.name));
    } catch {
      setExtractInspection(null);
    }
  };

  const handleLoadSecretFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setSecretFile({ name: file.name, type: file.type || 'application/octet-stream', bytes });
  };

  const handleEmbed = async () => {
    setError(null);
    if (!videoFile) {
      setError('MISSING_CARRIER_VIDEO: Select an .mp4, .webm, .mov, or binary carrier file.');
      return;
    }

    let payloadInput: PayloadInput;
    if (payloadKind === 'text') {
      if (!secretText) {
        setError('EMPTY_SECRET: Enter secret text to inject into container.');
        return;
      }
      payloadInput = { kind: 'text', text: secretText };
    } else {
      if (!secretFile) {
        setError('EMPTY_FILE: Select a secret binary file to embed.');
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
      await new Promise((r) => setTimeout(r, 20));
      const res = await embedInVideoFile(videoFile, payloadInput, {
        algorithm: cryptoState.algorithm,
        password: cryptoState.password,
        rsaPublicKeyPem: cryptoState.rsaPublicKeyPem,
      });
      setEmbedResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Container atom injection failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    setError(null);
    setExtractResult(null);
    if (!extractFile) {
      setError('MISSING_STEGO_VIDEO: Select a video or container file to scan.');
      return;
    }

    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const res = await extractFromVideoFile(extractFile, {
        password: cryptoState.password,
        rsaPrivateKeyPem: cryptoState.rsaPrivateKeyPem,
      });
      setExtractResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Container extraction failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadVideo = () => {
    if (!embedResult) return;
    const a = document.createElement('a');
    a.href = embedResult.stegoUrl;
    a.download = embedResult.fileName;
    a.click();
  };

  const handleSendToExtractor = () => {
    if (!embedResult) return;
    const f = new File([embedResult.stegoBlob], embedResult.fileName, {
      type: embedResult.mimeType,
    });
    handleLoadExtractVideo(f);
    setOperation('extract');
  };

  const activeBoxes =
    operation === 'embed'
      ? embedResult?.boxes ?? videoInspection?.boxes ?? []
      : extractInspection?.boxes ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1E222B]">
        <div>
          <h1 className="text-base font-semibold text-[#ECEEF2] tracking-tight">{t.videoTitle}</h1>
          <p className="text-xs font-mono text-[#949BA8] mt-0.5">{t.videoSubtitle}</p>
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

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#1E222B] rounded bg-[#111318] divide-y lg:divide-y-0 lg:divide-x divide-[#1E222B]">
        {/* Left Pane */}
        <div className="lg:col-span-6 p-5 space-y-5">
          <CryptoConfigPanel
            t={t}
            mode={operation}
            value={cryptoState}
            onChange={onCryptoChange}
            sessionRsaKeys={sessionRsaKeys}
            onSessionRsaKeysChange={onSessionRsaKeysChange}
          />

          {operation === 'embed' ? (
            <>
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#949BA8] font-medium">{t.coverVideoLabel}</span>
                  {videoInspection && (
                    <span className="font-mono text-[11px] text-[#10B981]">
                      {videoInspection.containerKind} · UNBOUNDED ATOM CAPACITY
                    </span>
                  )}
                </div>

                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv,*/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLoadVideoCarrier(f);
                  }}
                />

                <div
                  onClick={() => videoInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleLoadVideoCarrier(f);
                  }}
                  className="p-3.5 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer transition-colors"
                >
                  {videoFile ? (
                    <div className="space-y-1">
                      <div className="text-xs font-mono text-[#ECEEF2] truncate">
                        {videoFile.name}
                      </div>
                      <div className="text-[11px] font-mono text-[#949BA8] tabular-nums">
                        {formatBytes(videoFile.size)} · {videoInspection?.containerKind || 'DETECTED'}{' '}
                        · {videoInspection?.boxes.length ?? 0} top-level boxes
                      </div>
                    </div>
                  ) : (
                    <div className="py-3 flex flex-col items-center gap-1.5 text-center">
                      <Film className="w-5 h-5 text-[#5F6775]" />
                      <span className="text-xs text-[#949BA8]">{t.dropCoverVideo}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Secret Payload: Text or Full File */}
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
              </div>

              <button
                type="button"
                onClick={handleEmbed}
                disabled={busy}
                className="w-full h-10 px-4 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                {busy ? t.processing : t.embedVideoAction}
              </button>
            </>
          ) : (
            <>
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <span className="text-xs text-[#949BA8] font-medium">
                  Stego Video / Universal File Container
                </span>
                <input
                  ref={extractInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv,*/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLoadExtractVideo(f);
                  }}
                />
                <div
                  onClick={() => extractInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleLoadExtractVideo(f);
                  }}
                  className="p-4 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer text-center transition-colors"
                >
                  {extractFile ? (
                    <div className="space-y-1">
                      <div className="text-xs font-mono text-[#ECEEF2] truncate">
                        {extractFile.name}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#949BA8]">
                        {formatBytes(extractFile.size)}
                        {extractInspection?.hasKeyxerxesAtom && (
                          <span className="text-[#10B981]"> · KEYXERXES ATOM DETECTED</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-3 flex flex-col items-center gap-1.5">
                      <Film className="w-5 h-5 text-[#5F6775]" />
                      <span className="text-xs text-[#949BA8]">{t.dropCoverVideo}</span>
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
                {busy ? t.processing : t.extractVideoAction}
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

        {/* Right Pane: Video Preview & ISO-BMFF Atom Inspector */}
        <div className="lg:col-span-6 p-5 bg-[#0D0F14]/60 space-y-4">
          {operation === 'embed' ? (
            embedResult ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[#ECEEF2]">Stego Container Stream</span>
                  <span className="font-mono text-[11px] text-[#10B981]">
                    {embedResult.containerKind} · ZERO RE-ENCODE
                  </span>
                </div>

                {embedResult.mimeType.startsWith('video/') && (
                  <video
                    src={embedResult.stegoUrl}
                    controls
                    className="w-full max-h-[240px] bg-[#090A0D] border border-[#1E222B] rounded"
                  />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadVideo}
                    className="flex-1 h-9 px-3 bg-[#10B981] hover:bg-[#059669] text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.downloadStegoVideo} ({formatBytes(embedResult.stegoSize)})
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

                <div className="grid grid-cols-3 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.containerKind}</div>
                    <div className="text-xs font-mono text-[#10B981] mt-0.5">
                      {embedResult.containerKind}
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.overheadBytes}</div>
                    <div className="text-xs font-mono text-[#ECEEF2] tabular-nums mt-0.5">
                      +{formatBytes(embedResult.atomOverheadBytes)}
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">COMPRESSION</div>
                    <div className="text-xs font-mono text-[#10B981] tabular-nums mt-0.5">
                      {embedResult.metrics.usedCompression
                        ? `${embedResult.metrics.compressionRatio}%`
                        : 'RAW'}
                    </div>
                  </div>
                </div>

                <pre
                  dir="ltr"
                  className="p-2.5 bg-[#090A0D] border border-[#1E222B] rounded text-[10px] font-mono text-[#949BA8] overflow-x-auto leading-relaxed"
                >
                  {formatHexDump(embedResult.ciphertext, 64)}
                </pre>
              </div>
            ) : videoPreviewUrl && videoFile?.type.startsWith('video/') ? (
              <div className="space-y-3">
                <div className="text-xs font-medium text-[#ECEEF2]">Source Video Stream</div>
                <video
                  src={videoPreviewUrl}
                  controls
                  className="w-full max-h-[240px] bg-[#090A0D] border border-[#1E222B] rounded"
                />
              </div>
            ) : (
              <div className="min-h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1E222B] rounded space-y-2">
                <Boxes className="w-6 h-6 text-[#5F6775]" />
                <div className="text-xs font-mono text-[#949BA8]">
                  ISO-BMFF / EBML CONTAINER STANDBY
                </div>
                <p className="text-[11px] text-[#5F6775] max-w-sm">
                  Appends a spec-compliant ISO-BMFF uuid box (MP4/MOV) or EBML Void element
                  (WebM/MKV) with CRC-32 integrity and zero transcoding.
                </p>
              </div>
            )
          ) : extractResult ? (
            <ExtractedPayloadView
              t={t}
              payload={extractResult.payload}
              metaLine={`${extractResult.containerKind} · ${extractResult.algorithm} · ${extractResult.elapsedMs} ms`}
            />
          ) : (
            <div className="min-h-[200px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1E222B] rounded space-y-2">
              <Unlock className="w-6 h-6 text-[#5F6775]" />
              <div className="text-xs font-mono text-[#949BA8]">CONTAINER EXTRACTOR STANDBY</div>
              <p className="text-[11px] text-[#5F6775] max-w-sm">
                Upload a video or container file to locate the KEYXERXES uuid / Void atom, verify
                CRC-32, and decrypt the embedded payload.
              </p>
            </div>
          )}

          {/* Live ISO-BMFF / Container Box Table */}
          {activeBoxes.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#1E222B]">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[#949BA8] flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-[#10B981]" />
                  {t.containerInspector}
                </span>
                <span className="font-mono text-[11px] text-[#5F6775] tabular-nums">
                  {activeBoxes.length} entries
                </span>
              </div>

              <div className="border border-[#1E222B] rounded overflow-hidden" dir="ltr">
                <table className="w-full text-left font-mono text-[11px] tabular-nums">
                  <thead>
                    <tr className="bg-[#090A0D] text-[#5F6775] border-b border-[#1E222B]">
                      <th className="py-1.5 px-2.5 font-medium">{t.atomType}</th>
                      <th className="py-1.5 px-2.5 font-medium text-right">{t.atomOffset}</th>
                      <th className="py-1.5 px-2.5 font-medium text-right">{t.atomSize}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E222B] bg-[#0D0F14]">
                    {activeBoxes.map((b, idx) => (
                      <tr
                        key={`${b.type}-${idx}`}
                        className={b.isKeyxerxesPayload ? 'bg-[#10B981]/10 text-[#10B981]' : 'text-[#949BA8]'}
                      >
                        <td className="py-1.5 px-2.5 font-semibold">
                          {b.type}
                          {b.isKeyxerxesPayload ? ' [KX-PAYLOAD]' : ''}
                        </td>
                        <td className="py-1.5 px-2.5 text-right">
                          0x{b.offset.toString(16).toUpperCase().padStart(8, '0')}
                        </td>
                        <td className="py-1.5 px-2.5 text-right">{formatBytes(b.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
