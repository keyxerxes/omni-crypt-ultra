import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileUp,
  Hash,
  KeyRound,
  Lock,
  QrCode,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import {
  HashAlgorithm,
  RsaKeyPairPem,
  base64UrlToBytes,
  bytesToBase64Url,
  computeHashes,
  decryptBytes,
  detectWireAlgorithm,
  encryptBytes,
  formatHexDump,
  generateRsaKeyPair,
} from '../core/cryptoSuite';
import { DecodedPayload, formatBytes, packPayload, unpackPayload } from '../core/payloadFormat';
import { Translations } from '../i18n/translations';
import { CryptoConfigPanel, CryptoFormState } from './CryptoConfigPanel';
import { ExtractedPayloadView } from './ExtractedPayloadView';

type CryptoToolTab = 'cipher' | 'rsa' | 'hash' | 'qr';

interface CryptoToolsModuleProps {
  t: Translations;
  cryptoState: CryptoFormState;
  onCryptoChange: (next: CryptoFormState) => void;
  sessionRsaKeys: RsaKeyPairPem | null;
  onSessionRsaKeysChange: (keys: RsaKeyPairPem) => void;
}

export const CryptoToolsModule: React.FC<CryptoToolsModuleProps> = ({
  t,
  cryptoState,
  onCryptoChange,
  sessionRsaKeys,
  onSessionRsaKeysChange,
}) => {
  const [subTab, setSubTab] = useState<CryptoToolTab>('cipher');

  // --- Direct Cipher State ---
  const [cipherOp, setCipherOp] = useState<'embed' | 'extract'>('embed');
  const [cipherInputKind, setCipherInputKind] = useState<'text' | 'file'>('text');
  const [plainText, setPlainText] = useState('');
  const [plainFile, setPlainFile] = useState<{ name: string; type: string; bytes: Uint8Array } | null>(null);
  const [cipherInputB64, setCipherInputB64] = useState('');
  const [cipherUploadBytes, setCipherUploadBytes] = useState<{ name: string; bytes: Uint8Array } | null>(null);

  const [cipherOutputB64, setCipherOutputB64] = useState('');
  const [cipherOutputBytes, setCipherOutputBytes] = useState<Uint8Array | null>(null);
  const [cipherMetricsText, setCipherMetricsText] = useState('');
  const [decryptedOutput, setDecryptedOutput] = useState<{
    payload: DecodedPayload;
    meta: string;
  } | null>(null);

  // --- RSA Keygen State ---
  const [rsaBusy, setRsaBusy] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // --- Hasher State ---
  const [hashText, setHashText] = useState('');
  const [hashFileName, setHashFileName] = useState<string | null>(null);
  const [hashes, setHashes] = useState<Record<HashAlgorithm, string> | null>(null);
  const [verifyHash, setVerifyHash] = useState('');

  // --- Encrypted QR State ---
  const [qrPlaintext, setQrPlaintext] = useState('');
  const [qrEcLevel, setQrEcLevel] = useState<'L' | 'M' | 'Q' | 'H'>('M');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrCiphertext, setQrCiphertext] = useState('');
  const [qrByteCount, setQrByteCount] = useState(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plainFileRef = useRef<HTMLInputElement>(null);
  const encFileRef = useRef<HTMLInputElement>(null);
  const hashFileRef = useRef<HTMLInputElement>(null);

  // Live SHA-2 hashing for text input
  useEffect(() => {
    if (subTab !== 'hash' || hashFileName !== null) return;
    let cancelled = false;
    const run = async () => {
      if (!hashText) {
        setHashes(null);
        return;
      }
      const res = await computeHashes(new TextEncoder().encode(hashText));
      if (!cancelled) setHashes(res);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [hashText, hashFileName, subTab]);

  const copyValue = async (key: string, val: string) => {
    await navigator.clipboard.writeText(val);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const downloadTextFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleDirectEncrypt = async () => {
    setError(null);
    setBusy(true);
    try {
      const packed =
        cipherInputKind === 'text'
          ? (() => {
              if (!plainText) throw new Error('EMPTY_PLAINTEXT: Enter text to encrypt.');
              return packPayload({ kind: 'text', text: plainText });
            })()
          : (() => {
              if (!plainFile) throw new Error('EMPTY_FILE: Select a file to encrypt.');
              return packPayload({
                kind: 'file',
                fileName: plainFile.name,
                mimeType: plainFile.type,
                bytes: plainFile.bytes,
              });
            })();

      const { ciphertext, metrics } = await encryptBytes(packed, {
        algorithm: cryptoState.algorithm,
        password: cryptoState.password,
        rsaPublicKeyPem: cryptoState.rsaPublicKeyPem,
      });

      setCipherOutputBytes(ciphertext);
      setCipherOutputB64(
        ciphertext.byteLength <= 262_144
          ? bytesToBase64Url(ciphertext)
          : '[BINARY OUTPUT > 256 KB — USE .KXC FILE DOWNLOAD]'
      );
      setCipherMetricsText(
        `${metrics.algorithm} · ${formatBytes(metrics.ciphertextBytes)} · ${
          metrics.usedCompression ? `DEFLATE ${metrics.compressionRatio}% SAVED` : 'RAW'
        } · ${metrics.elapsedMs} ms`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Encryption failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDirectDecrypt = async () => {
    setError(null);
    setDecryptedOutput(null);
    setBusy(true);
    try {
      let wireBytes: Uint8Array;
      if (cipherUploadBytes) {
        wireBytes = cipherUploadBytes.bytes;
      } else {
        if (!cipherInputB64.trim()) {
          throw new Error('EMPTY_CIPHERTEXT: Paste KXU1 Base64URL ciphertext or upload a .kxc file.');
        }
        wireBytes = base64UrlToBytes(cipherInputB64);
      }

      const detected = detectWireAlgorithm(wireBytes);
      const res = await decryptBytes(wireBytes, {
        password: cryptoState.password,
        rsaPrivateKeyPem: cryptoState.rsaPrivateKeyPem,
      });
      const payload = unpackPayload(res.plaintext);
      setDecryptedOutput({
        payload,
        meta: `${detected || res.algorithm} · ${formatBytes(wireBytes.byteLength)} -> ${res.elapsedMs} ms`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decryption failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadKxc = () => {
    if (!cipherOutputBytes) return;
    const blob = new Blob([new Uint8Array(cipherOutputBytes)], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${plainFile ? plainFile.name : 'payload'}.kxc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleGenerateRsa = async () => {
    setError(null);
    setRsaBusy(true);
    try {
      const pair = await generateRsaKeyPair();
      onSessionRsaKeysChange(pair);
      onCryptoChange({
        ...cryptoState,
        rsaPublicKeyPem: pair.publicKeyPem,
        rsaPrivateKeyPem: pair.privateKeyPem,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'RSA-2048 keygen failed.');
    } finally {
      setRsaBusy(false);
    }
  };

  const handleHashFile = async (file: File) => {
    setError(null);
    setHashFileName(`${file.name} (${formatBytes(file.size)})`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await computeHashes(bytes);
    setHashes(res);
  };

  const handleGenerateQr = async () => {
    setError(null);
    setBusy(true);
    try {
      if (!qrPlaintext) {
        throw new Error('EMPTY_SECRET: Enter text to encrypt into a QR code.');
      }
      const packed = packPayload({ kind: 'text', text: qrPlaintext });
      const { ciphertext } = await encryptBytes(packed, {
        algorithm: cryptoState.algorithm,
        password: cryptoState.password,
        rsaPublicKeyPem: cryptoState.rsaPublicKeyPem,
      });

      const b64 = `KXU1:${bytesToBase64Url(ciphertext)}`;
      if (b64.length > 2200) {
        throw new Error(
          `QR_CAPACITY_EXCEEDED: Encrypted QR string (${b64.length} chars) exceeds reliable QR density limit (~2,200 chars).`
        );
      }

      const dataUrl = await QRCode.toDataURL(b64, {
        errorCorrectionLevel: qrEcLevel,
        width: 320,
        margin: 2,
        color: {
          dark: '#090A0D',
          light: '#ECEEF2',
        },
      });
      setQrDataUrl(dataUrl);
      setQrCiphertext(b64);
      setQrByteCount(b64.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Encrypted QR generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const normalizedVerify = verifyHash.trim().toLowerCase();
  const matchedAlgo =
    normalizedVerify && hashes
      ? (Object.entries(hashes).find(([, val]) => val === normalizedVerify)?.[0] ?? null)
      : null;

  return (
    <div className="space-y-4">
      {/* Header + Sub-tool Segmented Control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-[#1E222B]">
        <div>
          <h1 className="text-base font-semibold text-[#ECEEF2] tracking-tight">{t.cryptoTitle}</h1>
          <p className="text-xs font-mono text-[#949BA8] mt-0.5">{t.cryptoSubtitle}</p>
        </div>

        <div className="inline-flex flex-wrap items-center p-0.5 bg-[#111318] border border-[#1E222B] rounded shrink-0 self-start md:self-auto">
          {(
            [
              ['cipher', t.toolCipher, Lock],
              ['rsa', t.toolRsa, KeyRound],
              ['hash', t.toolHash, Hash],
              ['qr', t.toolQr, QrCode],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSubTab(id);
                setError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-sm inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                subTab === id
                  ? 'bg-[#161922] text-[#10B981] border border-[#2E3545]'
                  : 'text-[#949BA8] hover:text-[#ECEEF2] border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Tab 1: Direct Text / File Encryptor & Decryptor */}
      {subTab === 'cipher' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#1E222B] rounded bg-[#111318] divide-y lg:divide-y-0 lg:divide-x divide-[#1E222B]">
          <div className="lg:col-span-6 p-5 space-y-5">
            <div className="inline-flex bg-[#090A0D] border border-[#1E222B] rounded p-0.5">
              <button
                type="button"
                onClick={() => {
                  setCipherOp('embed');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-mono rounded-sm cursor-pointer transition-colors ${
                  cipherOp === 'embed' ? 'bg-[#161922] text-[#10B981]' : 'text-[#949BA8]'
                }`}
              >
                {t.encryptAction}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCipherOp('extract');
                  setError(null);
                }}
                className={`px-3 py-1.5 text-xs font-mono rounded-sm cursor-pointer transition-colors ${
                  cipherOp === 'extract' ? 'bg-[#161922] text-[#10B981]' : 'text-[#949BA8]'
                }`}
              >
                {t.decryptAction}
              </button>
            </div>

            <CryptoConfigPanel
              t={t}
              mode={cipherOp}
              value={cryptoState}
              onChange={onCryptoChange}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={onSessionRsaKeysChange}
            />

            {cipherOp === 'embed' ? (
              <div className="space-y-3 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#949BA8] font-medium">{t.payloadType}</span>
                  <div className="inline-flex bg-[#090A0D] border border-[#1E222B] rounded p-0.5">
                    <button
                      type="button"
                      onClick={() => setCipherInputKind('text')}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded-sm cursor-pointer ${
                        cipherInputKind === 'text' ? 'bg-[#161922] text-[#10B981]' : 'text-[#949BA8]'
                      }`}
                    >
                      {t.payloadText}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCipherInputKind('file')}
                      className={`px-2.5 py-1 text-[11px] font-mono rounded-sm cursor-pointer ${
                        cipherInputKind === 'file' ? 'bg-[#161922] text-[#10B981]' : 'text-[#949BA8]'
                      }`}
                    >
                      {t.payloadFile}
                    </button>
                  </div>
                </div>

                {cipherInputKind === 'text' ? (
                  <textarea
                    rows={5}
                    dir="auto"
                    value={plainText}
                    onChange={(e) => setPlainText(e.target.value)}
                    placeholder={t.secretPlaceholder}
                    className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
                  />
                ) : (
                  <div>
                    <input
                      ref={plainFileRef}
                      type="file"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          const bytes = new Uint8Array(await f.arrayBuffer());
                          setPlainFile({
                            name: f.name,
                            type: f.type || 'application/octet-stream',
                            bytes,
                          });
                        }
                      }}
                    />
                    <div
                      onClick={() => plainFileRef.current?.click()}
                      className="p-4 bg-[#090A0D] border border-dashed border-[#2E3545] hover:border-[#10B981] rounded cursor-pointer text-center"
                    >
                      {plainFile ? (
                        <span className="text-xs font-mono text-[#10B981] tabular-nums">
                          {plainFile.name} · {formatBytes(plainFile.bytes.byteLength)}
                        </span>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <FileUp className="w-4 h-4 text-[#5F6775]" />
                          <span className="text-xs text-[#949BA8]">{t.dropSecretFile}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleDirectEncrypt}
                  disabled={busy}
                  className="w-full h-10 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {busy ? t.processing : t.encryptAction}
                </button>
              </div>
            ) : (
              <div className="space-y-3 border-t border-[#1E222B] pt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#949BA8] font-medium">{t.ciphertextInput}</span>
                  <button
                    type="button"
                    onClick={() => encFileRef.current?.click()}
                    className="text-[11px] font-mono text-[#10B981] hover:underline cursor-pointer"
                  >
                    Upload .kxc binary
                  </button>
                  <input
                    ref={encFileRef}
                    type="file"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setCipherUploadBytes({
                          name: f.name,
                          bytes: new Uint8Array(await f.arrayBuffer()),
                        });
                      }
                    }}
                  />
                </div>

                {cipherUploadBytes ? (
                  <div className="p-3 bg-[#090A0D] border border-[#10B981]/40 rounded flex items-center justify-between text-xs font-mono">
                    <span className="text-[#10B981] truncate">
                      {cipherUploadBytes.name} ({formatBytes(cipherUploadBytes.bytes.byteLength)})
                    </span>
                    <button
                      type="button"
                      onClick={() => setCipherUploadBytes(null)}
                      className="text-[#949BA8] hover:text-[#ECEEF2] cursor-pointer"
                    >
                      {t.clear}
                    </button>
                  </div>
                ) : (
                  <textarea
                    rows={5}
                    dir="ltr"
                    value={cipherInputB64}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setCipherInputB64(v.startsWith('KXU1:') ? v.slice(5) : v);
                    }}
                    placeholder="Paste Base64URL KXU1 ciphertext (or QR output)..."
                    className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
                  />
                )}

                <button
                  type="button"
                  onClick={handleDirectDecrypt}
                  disabled={busy}
                  className="w-full h-10 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  {busy ? t.processing : t.decryptAction}
                </button>
              </div>
            )}

            {error && (
              <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded flex items-start gap-2.5 text-xs font-mono text-[#EF4444]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>

          {/* Direct Cipher Right Output */}
          <div className="lg:col-span-6 p-5 bg-[#0D0F14]/60 space-y-4">
            {cipherOp === 'embed' ? (
              cipherOutputBytes ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#ECEEF2]">{t.ciphertextOutput}</span>
                    <span className="font-mono text-[11px] text-[#10B981] tabular-nums">
                      {cipherMetricsText}
                    </span>
                  </div>
                  <textarea
                    readOnly
                    rows={6}
                    dir="ltr"
                    value={cipherOutputB64}
                    className="w-full p-3 bg-[#090A0D] border border-[#10B981]/40 rounded text-[11px] font-mono text-[#ECEEF2] break-all focus:outline-none"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => copyValue('cipher', cipherOutputB64)}
                      className="flex-1 h-9 px-3 bg-[#10B981] hover:bg-[#059669] text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copiedField === 'cipher' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      {copiedField === 'cipher' ? t.copied : t.copy}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadKxc}
                      className="h-9 px-3 bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] text-[#ECEEF2] font-mono text-xs rounded inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-[#10B981]" />
                      Download .kxc
                    </button>
                  </div>
                  <pre
                    dir="ltr"
                    className="p-2.5 bg-[#090A0D] border border-[#1E222B] rounded text-[10px] font-mono text-[#949BA8] overflow-x-auto leading-relaxed"
                  >
                    {formatHexDump(cipherOutputBytes, 96)}
                  </pre>
                </div>
              ) : (
                <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center border border-dashed border-[#1E222B] rounded p-6 space-y-2">
                  <ShieldCheck className="w-6 h-6 text-[#5F6775]" />
                  <div className="text-xs font-mono text-[#949BA8]">
                    AEAD ENVELOPE GENERATOR STANDBY
                  </div>
                </div>
              )
            ) : decryptedOutput ? (
              <ExtractedPayloadView
                t={t}
                payload={decryptedOutput.payload}
                metaLine={decryptedOutput.meta}
              />
            ) : (
              <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center border border-dashed border-[#1E222B] rounded p-6 space-y-2">
                <Unlock className="w-6 h-6 text-[#5F6775]" />
                <div className="text-xs font-mono text-[#949BA8]">DECRYPTOR STANDBY</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-Tab 2: RSA-2048 Keypair Generator */}
      {subTab === 'rsa' && (
        <div className="border border-[#1E222B] rounded bg-[#111318] p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1E222B]">
            <div>
              <h2 className="text-sm font-mono font-semibold text-[#ECEEF2]">
                RSA-OAEP 2048-BIT ASYMMETRIC KEYPAIR (SHA-256)
              </h2>
              <p className="text-xs text-[#949BA8] mt-0.5">
                Generated locally via Web Crypto CSPRNG. Keys automatically sync with RSA-2048
                Hybrid mode across all steganography modules.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerateRsa}
              disabled={rsaBusy}
              className="h-9 px-4 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {rsaBusy ? t.rsaGenerating : t.rsaGenInline}
            </button>
          </div>

          {sessionRsaKeys ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-3 py-2 bg-[#090A0D] border border-[#1E222B] rounded text-xs font-mono">
                <span className="text-[#5F6775]">{t.rsaFingerprint}</span>
                <span className="text-[#10B981] tabular-nums">{sessionRsaKeys.fingerprintSha256}</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Public Key */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[#10B981] font-medium">
                      SPKI PUBLIC KEY (SHARE FREELY)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyValue('pub', sessionRsaKeys.publicKeyPem)}
                        className="text-[11px] font-mono text-[#949BA8] hover:text-[#ECEEF2] inline-flex items-center gap-1 cursor-pointer"
                      >
                        {copiedField === 'pub' ? (
                          <Check className="w-3 h-3 text-[#10B981]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedField === 'pub' ? t.copied : t.copy}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadTextFile(sessionRsaKeys.publicKeyPem, 'keyxerxes_public.pem')
                        }
                        className="text-[11px] font-mono text-[#949BA8] hover:text-[#ECEEF2] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        .pem
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    rows={10}
                    dir="ltr"
                    value={sessionRsaKeys.publicKeyPem}
                    className="w-full p-3 bg-[#090A0D] border border-[#1E222B] rounded text-[11px] font-mono text-[#ECEEF2] focus:outline-none"
                  />
                </div>

                {/* Private Key */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[#F59E0B] font-medium">
                      PKCS#8 PRIVATE KEY (KEEP STRICTLY SECRET)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyValue('priv', sessionRsaKeys.privateKeyPem)}
                        className="text-[11px] font-mono text-[#949BA8] hover:text-[#ECEEF2] inline-flex items-center gap-1 cursor-pointer"
                      >
                        {copiedField === 'priv' ? (
                          <Check className="w-3 h-3 text-[#10B981]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedField === 'priv' ? t.copied : t.copy}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadTextFile(sessionRsaKeys.privateKeyPem, 'keyxerxes_private.pem')
                        }
                        className="text-[11px] font-mono text-[#949BA8] hover:text-[#ECEEF2] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        .pem
                      </button>
                    </div>
                  </div>
                  <textarea
                    readOnly
                    rows={10}
                    dir="ltr"
                    value={sessionRsaKeys.privateKeyPem}
                    className="w-full p-3 bg-[#090A0D] border border-[#F59E0B]/30 rounded text-[11px] font-mono text-[#ECEEF2] focus:outline-none"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center border border-dashed border-[#1E222B] rounded space-y-2">
              <KeyRound className="w-6 h-6 text-[#5F6775] mx-auto" />
              <div className="text-xs font-mono text-[#949BA8]">NO ACTIVE SESSION KEYPAIR</div>
              <p className="text-[11px] text-[#5F6775]">
                Click "{t.rsaGenInline}" to mint a fresh 2048-bit RSA-OAEP keypair in browser
                memory.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 3: SHA-2 Hash Generator & Verifier */}
      {subTab === 'hash' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#1E222B] rounded bg-[#111318] divide-y lg:divide-y-0 lg:divide-x divide-[#1E222B]">
          <div className="lg:col-span-5 p-5 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#949BA8] font-medium">Digest Input</span>
              <button
                type="button"
                onClick={() => hashFileRef.current?.click()}
                className="text-[11px] font-mono text-[#10B981] hover:underline cursor-pointer"
              >
                {t.hashOrUpload}
              </button>
              <input
                ref={hashFileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleHashFile(f);
                }}
              />
            </div>

            {hashFileName ? (
              <div className="p-3 bg-[#090A0D] border border-[#10B981]/40 rounded flex items-center justify-between text-xs font-mono">
                <span className="text-[#10B981] truncate">{hashFileName}</span>
                <button
                  type="button"
                  onClick={() => {
                    setHashFileName(null);
                    setHashes(null);
                  }}
                  className="text-[#949BA8] hover:text-[#ECEEF2] cursor-pointer"
                >
                  {t.clear}
                </button>
              </div>
            ) : (
              <textarea
                rows={7}
                dir="auto"
                value={hashText}
                onChange={(e) => setHashText(e.target.value)}
                placeholder={t.hashInputPlaceholder}
                className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
              />
            )}

            <div className="space-y-1.5 pt-2 border-t border-[#1E222B]">
              <label className="text-xs text-[#949BA8] font-medium">Integrity Verifier</label>
              <input
                type="text"
                dir="ltr"
                value={verifyHash}
                onChange={(e) => setVerifyHash(e.target.value)}
                placeholder={t.verifyHashPlaceholder}
                className="w-full h-9 px-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260]"
              />
              {normalizedVerify && hashes && (
                <div
                  className={`text-xs font-mono flex items-center gap-1.5 pt-1 ${
                    matchedAlgo ? 'text-[#10B981]' : 'text-[#EF4444]'
                  }`}
                >
                  {matchedAlgo ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {t.hashMatch} ({matchedAlgo})
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3.5 h-3.5" />
                      {t.hashMismatch}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-7 p-5 bg-[#0D0F14]/60 space-y-3">
            {(['SHA-256', 'SHA-384', 'SHA-512'] as HashAlgorithm[]).map((algo) => {
              const digest = hashes?.[algo] ?? '';
              return (
                <div
                  key={algo}
                  className="p-3 bg-[#090A0D] border border-[#1E222B] rounded space-y-1.5"
                  dir="ltr"
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-[#10B981] font-semibold">{algo}</span>
                    {digest && (
                      <button
                        type="button"
                        onClick={() => copyValue(algo, digest)}
                        className="text-[#949BA8] hover:text-[#ECEEF2] inline-flex items-center gap-1 cursor-pointer"
                      >
                        {copiedField === algo ? (
                          <Check className="w-3 h-3 text-[#10B981]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {copiedField === algo ? t.copied : t.copy}
                      </button>
                    )}
                  </div>
                  <div className="text-xs font-mono text-[#ECEEF2] break-all leading-relaxed">
                    {digest || <span className="text-[#4B5260]">—</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sub-Tab 4: Encrypted QR Code Generator */}
      {subTab === 'qr' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 border border-[#1E222B] rounded bg-[#111318] divide-y lg:divide-y-0 lg:divide-x divide-[#1E222B]">
          <div className="lg:col-span-7 p-5 space-y-5">
            <CryptoConfigPanel
              t={t}
              mode="embed"
              value={cryptoState}
              onChange={onCryptoChange}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={onSessionRsaKeysChange}
            />

            <div className="space-y-2 border-t border-[#1E222B] pt-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#949BA8] font-medium">{t.secretMessage}</span>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="text-[#5F6775]">{t.qrEcLevel}:</span>
                  {(['L', 'M', 'Q', 'H'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setQrEcLevel(lvl)}
                      className={`px-2 py-0.5 rounded border cursor-pointer ${
                        qrEcLevel === lvl
                          ? 'bg-[#161922] border-[#10B981] text-[#10B981]'
                          : 'bg-[#090A0D] border-[#1E222B] text-[#949BA8]'
                      }`}
                    >
                      {lvl}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                rows={4}
                dir="auto"
                value={qrPlaintext}
                onChange={(e) => setQrPlaintext(e.target.value)}
                placeholder="Enter secret note, recovery phrase, or coordinates to seal inside an encrypted QR matrix..."
                className="w-full p-3 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
              />
            </div>

            <button
              type="button"
              onClick={handleGenerateQr}
              disabled={busy}
              className="w-full h-10 bg-[#10B981] hover:bg-[#059669] disabled:opacity-50 text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              {busy ? t.processing : t.generateQrAction}
            </button>

            {error && (
              <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/40 rounded flex items-start gap-2.5 text-xs font-mono text-[#EF4444]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>

          <div className="lg:col-span-5 p-5 bg-[#0D0F14]/60 flex flex-col items-center justify-center gap-4">
            {qrDataUrl ? (
              <>
                <div className="p-3 bg-[#ECEEF2] rounded border border-[#2E3545]">
                  <img src={qrDataUrl} alt="Encrypted QR Matrix" className="w-60 h-60 block" />
                </div>
                <div className="text-[11px] font-mono text-[#949BA8] tabular-nums">
                  {cryptoState.algorithm} · ECC-{qrEcLevel} · {qrByteCount} chars
                </div>
                <div className="flex items-center gap-2 w-full">
                  <a
                    href={qrDataUrl}
                    download="keyxerxes_encrypted_qr.png"
                    className="flex-1 h-9 px-3 bg-[#10B981] hover:bg-[#059669] text-[#090A0D] font-mono text-xs font-semibold rounded inline-flex items-center justify-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t.downloadQrPng}
                  </a>
                  <button
                    type="button"
                    onClick={() => copyValue('qr', qrCiphertext)}
                    className="h-9 px-3 bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] text-[#ECEEF2] font-mono text-xs rounded inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {copiedField === 'qr' ? (
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedField === 'qr' ? t.copied : t.copy}
                  </button>
                </div>
              </>
            ) : (
              <div className="w-full min-h-[260px] flex flex-col items-center justify-center text-center border border-dashed border-[#1E222B] rounded p-6 space-y-2">
                <QrCode className="w-7 h-7 text-[#5F6775]" />
                <div className="text-xs font-mono text-[#949BA8]">ENCRYPTED QR MATRIX STANDBY</div>
                <p className="text-[11px] text-[#5F6775] max-w-xs">
                  Generates a scannable ISO/IEC 18004 QR code containing an authenticated KXU1
                  ciphertext payload.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
