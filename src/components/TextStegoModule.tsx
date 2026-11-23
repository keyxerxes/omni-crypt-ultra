import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  Copy,
  Lock,
  Sparkles,
  Terminal,
  Unlock,
} from 'lucide-react';
import { RsaKeyPairPem, formatHexDump } from '../core/cryptoSuite';
import { formatBytes } from '../core/payloadFormat';
import {
  SAMPLE_ENGLISH_COVER,
  SAMPLE_PERSIAN_COVER,
  TextEmbedResult,
  TextExtractResult,
  TextStegoMode,
  analyzeCoverTextCapacity,
  embedInCoverText,
  extractFromCoverText,
} from '../engines/textStego';
import { Translations } from '../i18n/translations';
import { CryptoConfigPanel, CryptoFormState } from './CryptoConfigPanel';
import { ExtractedPayloadView } from './ExtractedPayloadView';

interface TextStegoModuleProps {
  t: Translations;
  cryptoState: CryptoFormState;
  onCryptoChange: (next: CryptoFormState) => void;
  sessionRsaKeys: RsaKeyPairPem | null;
  onSessionRsaKeysChange: (keys: RsaKeyPairPem) => void;
}

export const TextStegoModule: React.FC<TextStegoModuleProps> = ({
  t,
  cryptoState,
  onCryptoChange,
  sessionRsaKeys,
  onSessionRsaKeysChange,
}) => {
  const [operation, setOperation] = useState<'embed' | 'extract'>('embed');
  const [stegoMode, setStegoMode] = useState<TextStegoMode>('ZERO_WIDTH');
  const [extractMode, setExtractMode] = useState<TextStegoMode | 'AUTO'>('AUTO');

  const [coverText, setCoverText] = useState(SAMPLE_PERSIAN_COVER);
  const [secretMessage, setSecretMessage] = useState('');
  const [stegoInput, setStegoInput] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embedResult, setEmbedResult] = useState<TextEmbedResult | null>(null);
  const [extractResult, setExtractResult] = useState<TextExtractResult | null>(null);
  const [copiedStego, setCopiedStego] = useState(false);

  const capacity = useMemo(
    () => analyzeCoverTextCapacity(coverText, stegoMode),
    [coverText, stegoMode]
  );

  const estimatedSecretBytes = useMemo(() => {
    if (!secretMessage) return 0;
    const utf8Len = new TextEncoder().encode(secretMessage).byteLength;
    const overhead =
      cryptoState.algorithm === 'RSA-OAEP-HYBRID'
        ? 300
        : cryptoState.algorithm === 'CASCADE-AES-CHACHA'
        ? 82
        : 54;
    return utf8Len + overhead;
  }, [secretMessage, cryptoState.algorithm]);

  const homoglyphOverflow =
    stegoMode === 'HOMOGLYPH' &&
    estimatedSecretBytes > 0 &&
    estimatedSecretBytes > capacity.maxHomoglyphBytes;

  const handleEmbed = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await embedInCoverText(coverText, secretMessage, stegoMode, {
        algorithm: cryptoState.algorithm,
        password: cryptoState.password,
        rsaPublicKeyPem: cryptoState.rsaPublicKeyPem,
      });
      setEmbedResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Text steganography operation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    setError(null);
    setExtractResult(null);
    setBusy(true);
    try {
      const res = await extractFromCoverText(stegoInput, extractMode, {
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

  const handleCopyStego = async () => {
    if (!embedResult) return;
    await navigator.clipboard.writeText(embedResult.stegoText);
    setCopiedStego(true);
    setTimeout(() => setCopiedStego(false), 1500);
  };

  const handleSendToExtractor = () => {
    if (!embedResult) return;
    setStegoInput(embedResult.stegoText);
    setExtractMode('AUTO');
    setExtractResult(null);
    setError(null);
    setOperation('extract');
  };

  return (
    <div className="space-y-4">
      {/* Module Header Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1E222B]">
        <div>
          <h1 className="text-base font-semibold text-[#ECEEF2] tracking-tight">{t.textTitle}</h1>
          <p className="text-xs font-mono text-[#949BA8] mt-0.5">{t.textSubtitle}</p>
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

      {/* Main Split Workstation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#1E222B] rounded bg-[#111318] divide-y lg:divide-y-0 lg:divide-x divide-[#1E222B]">
        {/* Left Pane: Configuration & Inputs */}
        <div className="lg:col-span-7 p-5 space-y-5">
          {/* Stealth Mode Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#949BA8] font-medium">Carrier Injection Mode</span>
              <span className="font-mono text-[11px] text-[#5F6775]">
                {stegoMode === 'ZERO_WIDTH'
                  ? 'U+200B / U+200C / U+200D / U+FEFF'
                  : 'ک/ك (U+06A9/U+0643) · ی/ي (U+06CC/U+064A)'}
              </span>
            </div>

            {operation === 'embed' ? (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['ZERO_WIDTH', t.textModeZeroWidth, 'ZWNJ-Safe Word-Boundary Injection'],
                    ['HOMOGLYPH', t.textModeHomoglyph, 'Survives ZW-Stripping Platforms'],
                  ] as const
                ).map(([id, label, desc]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setStegoMode(id)}
                    className={`p-2.5 rounded text-start border transition-colors cursor-pointer ${
                      stegoMode === id
                        ? 'bg-[#161922] border-[#10B981] text-[#ECEEF2]'
                        : 'bg-[#090A0D] border-[#1E222B] text-[#949BA8] hover:border-[#2E3545]'
                    }`}
                  >
                    <div className="text-xs font-medium">{label}</div>
                    <div className="text-[10px] font-mono text-[#5F6775] mt-0.5 truncate">
                      {desc}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    ['AUTO', t.textModeAuto],
                    ['ZERO_WIDTH', t.textModeZeroWidth],
                    ['HOMOGLYPH', t.textModeHomoglyph],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setExtractMode(id)}
                    className={`px-2.5 py-2 rounded text-xs font-mono border transition-colors cursor-pointer whitespace-nowrap ${
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
              {/* Cover Text Input */}
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label className="text-[#949BA8] font-medium">{t.coverTextLabel}</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCoverText(SAMPLE_PERSIAN_COVER)}
                      className="text-[11px] font-mono text-[#10B981] hover:underline cursor-pointer"
                    >
                      {t.loadPersianSample}
                    </button>
                    <span className="text-[#2E3545]">/</span>
                    <button
                      type="button"
                      onClick={() => setCoverText(SAMPLE_ENGLISH_COVER)}
                      className="text-[11px] font-mono text-[#949BA8] hover:text-[#ECEEF2] hover:underline cursor-pointer"
                    >
                      {t.loadEnglishSample}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={5}
                  dir="auto"
                  value={coverText}
                  onChange={(e) => setCoverText(e.target.value)}
                  placeholder={t.coverTextPlaceholder}
                  className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs text-[#ECEEF2] placeholder:text-[#4B5260] leading-relaxed resize-y"
                />
                {/* Inline Capacity Readout (No Pills) */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#949BA8] tabular-nums">
                  <span>
                    {coverText.length} chars · {t.wordBoundaries}: {capacity.wordBoundaries} ·{' '}
                    {t.homoglyphSlots}: {capacity.persianHomoglyphSlots} (ک/ی)
                    {capacity.latinHomoglyphSlots > 0
                      ? ` + ${capacity.latinHomoglyphSlots} (Latin)`
                      : ''}
                  </span>
                  {stegoMode === 'HOMOGLYPH' ? (
                    <span className={homoglyphOverflow ? 'text-[#F59E0B]' : 'text-[#10B981]'}>
                      MAX: {capacity.maxHomoglyphBytes} B ({capacity.totalHomoglyphBits} bits)
                    </span>
                  ) : (
                    <span className="text-[#10B981]">MAX: 65,535 B (ZW-4SYM)</span>
                  )}
                </div>
              </div>

              {/* Secret Message Input */}
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-[#949BA8] font-medium">{t.secretMessage}</label>
                  <span className="font-mono text-[11px] text-[#5F6775] tabular-nums">
                    {new TextEncoder().encode(secretMessage).byteLength} B raw
                  </span>
                </div>
                <textarea
                  rows={3}
                  dir="auto"
                  value={secretMessage}
                  onChange={(e) => setSecretMessage(e.target.value)}
                  placeholder={t.secretPlaceholder}
                  className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
                />
                {homoglyphOverflow && (
                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#F59E0B]">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {t.overflowWarning} (~{estimatedSecretBytes} B est. &gt;{' '}
                      {capacity.maxHomoglyphBytes} B homoglyph slots; compression may reduce size).
                    </span>
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
                {busy ? t.processing : t.embedTextAction}
              </button>
            </>
          ) : (
            <>
              <div className="space-y-2 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-[#949BA8] font-medium">{t.stegoOutputLabel}</label>
                  <span className="font-mono text-[11px] text-[#5F6775] tabular-nums">
                    {stegoInput.length} chars
                  </span>
                </div>
                <textarea
                  rows={7}
                  dir="auto"
                  value={stegoInput}
                  onChange={(e) => setStegoInput(e.target.value)}
                  placeholder={t.stegoInputPlaceholder}
                  className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs text-[#ECEEF2] placeholder:text-[#4B5260] leading-relaxed resize-y"
                />
              </div>

              <button
                type="button"
                onClick={handleExtract}
                disabled={busy}
                className="w-full h-10 px-4 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Unlock className="w-3.5 h-3.5" />
                {busy ? t.processing : t.extractTextAction}
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

        {/* Right Pane: Output & Cryptographic Telemetry */}
        <div className="lg:col-span-5 p-5 flex flex-col justify-between gap-5 bg-[#0D0F14]/60">
          {operation === 'embed' ? (
            embedResult ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#ECEEF2]">{t.stegoOutputLabel}</span>
                  <span className="text-[11px] font-mono text-[#10B981] tabular-nums">
                    {embedResult.mode} · VERIFIED
                  </span>
                </div>

                <textarea
                  readOnly
                  rows={7}
                  dir="auto"
                  value={embedResult.stegoText}
                  className="w-full p-3 bg-[#090A0D] border border-[#10B981]/40 rounded text-xs text-[#ECEEF2] leading-relaxed focus:outline-none"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyStego}
                    className="flex-1 h-9 px-3 bg-[#10B981] hover:bg-[#059669] text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {copiedStego ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedStego ? t.copied : t.copyStegoText}
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

                {/* Real Pipeline Metrics Grid */}
                <div className="grid grid-cols-2 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">COMPRESSION RATIO</div>
                    <div className="text-xs font-mono font-semibold text-[#10B981] tabular-nums mt-0.5">
                      {embedResult.metrics.usedCompression
                        ? `${embedResult.metrics.compressionRatio}% SAVED`
                        : 'RAW (SMALL PAYLOAD)'}
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">CIPHERTEXT SIZE</div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {formatBytes(embedResult.metrics.ciphertextBytes)}
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">
                      {embedResult.mode === 'ZERO_WIDTH' ? 'ZW CHARS INJECTED' : 'HOMOGLYPH BITS'}
                    </div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {embedResult.mode === 'ZERO_WIDTH'
                        ? `${embedResult.injectedChars} chars / ${embedResult.slotsUsed} gaps`
                        : `${embedResult.slotsUsed} / ${embedResult.slotsAvailable} slots`}
                    </div>
                  </div>
                  <div className="bg-[#090A0D] p-2.5">
                    <div className="text-[10px] font-mono text-[#5F6775]">EXECUTION TIME</div>
                    <div className="text-xs font-mono font-semibold text-[#ECEEF2] tabular-nums mt-0.5">
                      {embedResult.metrics.elapsedMs} ms
                    </div>
                  </div>
                </div>

                {/* Ciphertext Hex Dump */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-mono text-[#5F6775] flex items-center gap-1.5">
                    <Terminal className="w-3 h-3" />
                    {t.hexPreview} (KXU1)
                  </div>
                  <pre
                    dir="ltr"
                    className="p-2.5 bg-[#090A0D] border border-[#1E222B] rounded text-[10px] font-mono text-[#949BA8] overflow-x-auto leading-relaxed"
                  >
                    {formatHexDump(embedResult.ciphertext, 80)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 space-y-2 border border-dashed border-[#1E222B] rounded">
                <Sparkles className="w-5 h-5 text-[#5F6775]" />
                <div className="text-xs font-mono text-[#949BA8]">
                  PIPELINE STANDBY · DEFLATE-RAW + {cryptoState.algorithm}
                </div>
                <p className="text-[11px] text-[#5F6775] max-w-xs">
                  Enter a passphrase and secret payload on the left to generate a visually identical
                  Persian or English carrier text.
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
              <div className="grid grid-cols-2 gap-px bg-[#1E222B] border border-[#1E222B] rounded overflow-hidden">
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">CARRIER ENGINE</div>
                  <div className="text-xs font-mono text-[#10B981] mt-0.5">
                    {extractResult.detectedMode}
                  </div>
                </div>
                <div className="bg-[#090A0D] p-2.5">
                  <div className="text-[10px] font-mono text-[#5F6775]">CIPHERTEXT DECODED</div>
                  <div className="text-xs font-mono text-[#ECEEF2] tabular-nums mt-0.5">
                    {formatBytes(extractResult.ciphertextBytes)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-12 px-4 space-y-2 border border-dashed border-[#1E222B] rounded">
              <Unlock className="w-5 h-5 text-[#5F6775]" />
              <div className="text-xs font-mono text-[#949BA8]">EXTRACTOR STANDBY</div>
              <p className="text-[11px] text-[#5F6775] max-w-xs">
                Paste steganographic text and supply the matching passphrase or RSA-2048 Private Key
                to verify AEAD tag and recover the hidden payload.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
