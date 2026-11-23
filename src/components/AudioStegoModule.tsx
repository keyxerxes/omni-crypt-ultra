import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  AudioLines,
  Download,
  FileUp,
  Lock,
  Unlock,
} from 'lucide-react';
import { RsaKeyPairPem, formatHexDump } from '../core/cryptoSuite';
import { PayloadInput, formatBytes } from '../core/payloadFormat';
import {
  AudioEmbedResult,
  AudioExtractResult,
  LoadedAudioCarrier,
  decodeAudioCarrier,
  embedInAudio,
  extractFromWavBlob,
  generateSyntheticCarrierWav,
} from '../engines/audioStego';
import { Translations } from '../i18n/translations';
import { CryptoConfigPanel, CryptoFormState } from './CryptoConfigPanel';
import { ExtractedPayloadView } from './ExtractedPayloadView';
import { WaveformPlayer } from './WaveformPlayer';

interface AudioStegoModuleProps {
  t: Translations;
  cryptoState: CryptoFormState;
  onCryptoChange: (next: CryptoFormState) => void;
  sessionRsaKeys: RsaKeyPairPem | null;
  onSessionRsaKeysChange: (keys: RsaKeyPairPem) => void;
}

export const AudioStegoModule: React.FC<AudioStegoModuleProps> = ({
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

  const [carrier, setCarrier] = useState<LoadedAudioCarrier | null>(null);
  const [carrierPreviewUrl, setCarrierPreviewUrl] = useState<string | null>(null);

  const [extractBlob, setExtractBlob] = useState<Blob | null>(null);
  const [extractFileName, setExtractFileName] = useState('');

  const [embedResult, setEmbedResult] = useState<AudioEmbedResult | null>(null);
  const [extractResult, setExtractResult] = useState<AudioExtractResult | null>(null);

  const [busy, setBusy] = useState(false);
  const [decodingCarrier, setDecodingCarrier] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carrierInputRef = useRef<HTMLInputElement>(null);
  const secretFileInputRef = useRef<HTMLInputElement>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (carrierPreviewUrl) URL.revokeObjectURL(carrierPreviewUrl);
    };
  }, [carrierPreviewUrl]);

  useEffect(() => {
    return () => {
      if (embedResult) URL.revokeObjectURL(embedResult.wavUrl);
    };
  }, [embedResult]);

  const rawPayloadSize = useMemo(() => {
    if (payloadKind === 'text') return new TextEncoder().encode(secretText).byteLength;
    return secretFile ? secretFile.bytes.byteLength : 0;
  }, [payloadKind, secretText, secretFile]);

  const capacityPercent =
    carrier && carrier.maxPayloadBytes > 0
      ? Math.min(100, Math.round((rawPayloadSize / carrier.maxPayloadBytes) * 100))
      : 0;

  const handleLoadAudioCarrier = async (file: File) => {
    setError(null);
    setDecodingCarrier(true);
    try {
      const decoded = await decodeAudioCarrier(file);
      setCarrier(decoded);
      setCarrierPreviewUrl(URL.createObjectURL(file));
      setEmbedResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decode audio file.');
    } finally {
      setDecodingCarrier(false);
    }
  };

  const handleGenerateSample = async () => {
    const sampleFile = generateSyntheticCarrierWav(4);
    await handleLoadAudioCarrier(sampleFile);
  };

  const handleLoadSecretFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    setSecretFile({ name: file.name, type: file.type || 'application/octet-stream', bytes });
  };

  const handleEmbed = async () => {
    setError(null);
    if (!carrier) {
      setError('MISSING_AUDIO_CARRIER: Upload an MP3/WAV/OGG track or synthesize a carrier first.');
      return;
    }

    let payloadInput: PayloadInput;
    if (payloadKind === 'text') {
      if (!secretText) {
        setError('EMPTY_SECRET: Enter secret text to embed.');
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
      await new Promise((r) => setTimeout(r, 20));
      const res = await embedInAudio(carrier, payloadInput, {
        algorithm: cryptoState.algorithm,
        password: cryptoState.password,
        rsaPublicKeyPem: cryptoState.rsaPublicKeyPem,
      });
      setEmbedResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio embedding failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    setError(null);
    setExtractResult(null);
    if (!extractBlob) {
      setError('MISSING_WAV: Upload a lossless steganographic .wav file.');
      return;
    }

    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 20));
      const res = await extractFromWavBlob(extractBlob, {
        password: cryptoState.password,
        rsaPrivateKeyPem: cryptoState.rsaPrivateKeyPem,
      });
      setExtractResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WAV extraction failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadWav = () => {
    if (!embedResult) return;
    const a = document.createElement('a');
    a.href = embedResult.wavUrl;
    a.download = embedResult.fileName;
    a.click();
  };

  const handleSendToExtractor = () => {
    if (!embedResult) return;
    setExtractBlob(embedResult.wavBlob);
    setExtractFileName(embedResult.fileName);
    setExtractResult(null);
    setError(null);
    setOperation('extract');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1E222B]">
        <div>
          <h1 className="text-base font-semibold text-[#ECEEF2] tracking-tight">{t.audioTitle}</h1>
          <p className="text-xs font-mono text-[#949BA8] mt-0.5">{t.audioSubtitle}</p>
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
                  <span className="text-[#949BA8] font-medium">{t.coverAudioLabel}</span>
                  <button
                    type="button"
                    onClick={handleGenerateSample}
                    className="text-[11px] font-mono text-[#10B981] hover:underline cursor-pointer"
                  >
                    {t.generateSampleAudio}
                  </button>
                </div>

                <input
                  ref={carrierInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLoadAudioCarrier(f);
                  }}
                />

                <div
                  onClick={() => carrierInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) handleLoadAudioCarrier(f);
                  }}
                  className="p-3.5 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer transition-colors"
                >
                  {decodingCarrier ? (
                    <div className="py-2 text-center text-xs font-mono text-[#10B981]">
                      DECODING PCM SAMPLES...
                    </div>
                  ) : carrier ? (
                    <div className="space-y-1">
                      <div className="text-xs font-mono text-[#ECEEF2] truncate">
                        {carrier.fileName}
                      </div>
                      <div className="text-[11px] font-mono text-[#949BA8] tabular-nums">
                        {carrier.sampleRate.toLocaleString()} Hz · {carrier.channels}ch ·{' '}
                        {carrier.durationSec.toFixed(2)}s · MAX:{' '}
                        <span className="text-[#10B981]">{formatBytes(carrier.maxPayloadBytes)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-3 flex flex-col items-center gap-1.5 text-center">
                      <AudioLines className="w-5 h-5 text-[#5F6775]" />
                      <span className="text-xs text-[#949BA8]">{t.dropCoverAudio}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Secret Payload: Text or File */}
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

                {carrier && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-[#949BA8]">
                        2-BIT PCM CAPACITY: {formatBytes(rawPayloadSize)} /{' '}
                        {formatBytes(carrier.maxPayloadBytes)}
                      </span>
                      <span
                        className={
                          rawPayloadSize > carrier.maxPayloadBytes
                            ? 'text-[#F59E0B]'
                            : 'text-[#10B981]'
                        }
                      >
                        {capacityPercent}%
                      </span>
                    </div>
                    <div className="h-1 bg-[#1E222B] rounded-sm overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          rawPayloadSize > carrier.maxPayloadBytes ? 'bg-[#F59E0B]' : 'bg-[#10B981]'
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
                {busy ? t.processing : t.embedAudioAction}
              </button>
            </>
          ) : (
            <>
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <span className="text-xs text-[#949BA8] font-medium">Lossless Stego .WAV File</span>
                <input
                  ref={extractInputRef}
                  type="file"
                  accept="audio/wav,.wav"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setExtractBlob(f);
                      setExtractFileName(f.name);
                      setExtractResult(null);
                      setError(null);
                    }
                  }}
                />
                <div
                  onClick={() => extractInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) {
                      setExtractBlob(f);
                      setExtractFileName(f.name);
                      setExtractResult(null);
                      setError(null);
                    }
                  }}
                  className="p-4 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer text-center transition-colors"
                >
                  {extractBlob ? (
                    <div className="text-xs font-mono text-[#10B981] tabular-nums">
                      {extractFileName} · {formatBytes(extractBlob.size)}
                    </div>
                  ) : (
                    <div className="py-3 flex flex-col items-center gap-1.5">
                      <AudioLines className="w-5 h-5 text-[#5F6775]" />
                      <span className="text-xs text-[#949BA8]">
                        Drop lossless .WAV carrier file (or click to browse)
                      </span>
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
                {busy ? t.processing : t.extractAudioAction}
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

        {/* Right Pane: Waveform Monitor & Telemetry */}
        <div className="lg:col-span-6 p-5 bg-[#0D0F14]/60 space-y-4">
          {operation === 'embed' ? (
            embedResult ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#ECEEF2]">{t.waveformPreview}</span>
                  <span className="text-[11px] font-mono text-[#10B981] tabular-nums">
                    PCM 16-BIT · 2-BIT LSB VERIFIED
                  </span>
                </div>

                <WaveformPlayer
                  audioUrl={embedResult.wavUrl}
                  peaks={embedResult.waveformPeaks}
                  durationSec={embedResult.durationSec}
                  label={embedResult.fileName}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadWav}
                    className="flex-1 h-9 px-3 bg-[#10B981] hover:bg-[#059669] text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.downloadStegoWav} ({formatBytes(embedResult.wavBlob.size)})
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.snrLabel}</div>
                    <div className="text-xs font-mono font-semibold text-[#10B981] tabular-nums mt-0.5">
                      {embedResult.snrDb} dB
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">{t.sampleRate}</div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {(embedResult.sampleRate / 1000).toFixed(1)} kHz
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">CIPHERTEXT</div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {formatBytes(embedResult.metrics.ciphertextBytes)}
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

                <pre
                  dir="ltr"
                  className="p-2.5 bg-[#090A0D] border border-[#1E222B] rounded text-[10px] font-mono text-[#949BA8] overflow-x-auto leading-relaxed"
                >
                  {formatHexDump(embedResult.ciphertext, 64)}
                </pre>
              </div>
            ) : carrier && carrierPreviewUrl ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#ECEEF2] font-medium">Source Carrier Waveform</span>
                  <span className="font-mono text-[11px] text-[#949BA8] tabular-nums">
                    {carrier.totalSamples.toLocaleString()} PCM samples
                  </span>
                </div>
                <WaveformPlayer
                  audioUrl={carrierPreviewUrl}
                  peaks={carrier.waveformPeaks}
                  durationSec={carrier.durationSec}
                  label={carrier.fileName}
                />
                <div className="p-3 bg-[#090A0D] border border-[#1E222B] rounded text-[11px] font-mono text-[#949BA8] space-y-1">
                  <div>INJECTION SCHEME: 2-BIT LSB ACROSS 16-BIT SIGNED PCM SAMPLES</div>
                  <div>THEORETICAL NOISE FLOOR: -78 dBFS (PERCEPTUALLY TRANSPARENT)</div>
                  <div>MAX EMBEDDABLE PAYLOAD: {formatBytes(carrier.maxPayloadBytes)}</div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1E222B] rounded space-y-2">
                <AudioLines className="w-6 h-6 text-[#5F6775]" />
                <div className="text-xs font-mono text-[#949BA8]">AUDIO ENGINE STANDBY</div>
                <p className="text-[11px] text-[#5F6775] max-w-sm">
                  Drop an MP3, WAV, or OGG track—or synthesize a 44.1kHz stereo WAV carrier—to hide
                  encrypted text or binary files in lossless 16-bit PCM samples.
                </p>
              </div>
            )
          ) : extractResult ? (
            <div className="space-y-4">
              <ExtractedPayloadView
                t={t}
                payload={extractResult.payload}
                metaLine={`PCM-2BIT · ${extractResult.algorithm} · ${extractResult.elapsedMs} ms`}
              />
              <div className="grid grid-cols-2 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">HEADER SIGNATURE</div>
                  <div className="text-xs font-mono text-[#10B981] mt-0.5">KXAU (PCM-16 LE)</div>
                </div>
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">CIPHERTEXT SIZE</div>
                  <div className="text-xs font-mono text-[#ECEEF2] tabular-nums mt-0.5">
                    {formatBytes(extractResult.ciphertextBytes)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#1E222B] rounded space-y-2">
              <Unlock className="w-6 h-6 text-[#5F6775]" />
              <div className="text-xs font-mono text-[#949BA8]">WAV EXTRACTOR STANDBY</div>
              <p className="text-[11px] text-[#5F6775] max-w-sm">
                Parses raw RIFF/WAVE Int16 PCM data chunks directly without float resampling loss.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
