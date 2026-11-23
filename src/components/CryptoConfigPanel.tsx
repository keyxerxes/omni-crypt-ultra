import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, KeyRound, RefreshCw, Shield, SlidersHorizontal } from 'lucide-react';
import {
  CryptoAlgorithm,
  PasswordGenConfig,
  RsaKeyPairPem,
  estimatePasswordEntropy,
  generateRsaKeyPair,
  generateSecurePassword,
} from '../core/cryptoSuite';
import { Translations } from '../i18n/translations';

export interface CryptoFormState {
  algorithm: CryptoAlgorithm;
  password: string;
  rsaPublicKeyPem: string;
  rsaPrivateKeyPem: string;
}

interface CryptoConfigPanelProps {
  t: Translations;
  mode: 'embed' | 'extract';
  value: CryptoFormState;
  onChange: (next: CryptoFormState) => void;
  sessionRsaKeys: RsaKeyPairPem | null;
  onSessionRsaKeysChange: (keys: RsaKeyPairPem) => void;
  hideAlgorithmSelectorOnExtract?: boolean;
}

const ALGO_OPTIONS: Array<{ id: CryptoAlgorithm; label: string; spec: string }> = [
  { id: 'AES-256-GCM', label: 'AES-256-GCM', spec: 'PBKDF2 150k' },
  { id: 'CHACHA20-POLY1305', label: 'ChaCha20-Poly1305', spec: 'RFC 8439' },
  { id: 'CASCADE-AES-CHACHA', label: 'Cascade Dual', spec: 'AES + ChaCha20' },
  { id: 'RSA-OAEP-HYBRID', label: 'RSA-2048 Hybrid', spec: 'OAEP + AES-GCM' },
];

export const CryptoConfigPanel: React.FC<CryptoConfigPanelProps> = ({
  t,
  mode,
  value,
  onChange,
  sessionRsaKeys,
  onSessionRsaKeysChange,
  hideAlgorithmSelectorOnExtract = false,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [generatingRsa, setGeneratingRsa] = useState(false);
  const [genConfig, setGenConfig] = useState<PasswordGenConfig>({
    length: 28,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
  });

  const entropy = estimatePasswordEntropy(value.password);
  const isRsa = value.algorithm === 'RSA-OAEP-HYBRID';

  const handleGeneratePwd = () => {
    const pwd = generateSecurePassword(genConfig);
    onChange({ ...value, password: pwd });
  };

  const handleCopyPwd = async () => {
    if (!value.password) return;
    await navigator.clipboard.writeText(value.password);
    setCopiedPwd(true);
    setTimeout(() => setCopiedPwd(false), 1500);
  };

  const handleGenerateRsa = async () => {
    setGeneratingRsa(true);
    try {
      const pair = await generateRsaKeyPair();
      onSessionRsaKeysChange(pair);
      onChange({
        ...value,
        rsaPublicKeyPem: pair.publicKeyPem,
        rsaPrivateKeyPem: pair.privateKeyPem,
      });
    } finally {
      setGeneratingRsa(false);
    }
  };

  const entropyColor =
    entropy.grade === 'MILITARY' || entropy.grade === 'STRONG'
      ? 'bg-[#10B981]'
      : entropy.grade === 'MODERATE'
      ? 'bg-[#F59E0B]'
      : 'bg-[#EF4444]';

  const entropyTextColor =
    entropy.grade === 'MILITARY' || entropy.grade === 'STRONG'
      ? 'text-[#10B981]'
      : entropy.grade === 'MODERATE'
      ? 'text-[#F59E0B]'
      : 'text-[#EF4444]';

  const entropyWidth = Math.min(100, Math.round((entropy.bits / 128) * 100));

  return (
    <div className="space-y-4">
      {!(mode === 'extract' && hideAlgorithmSelectorOnExtract) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#949BA8] font-medium flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#10B981]" />
              {t.cipherSuite}
            </span>
            <span className="font-mono text-[11px] text-[#5F6775]">
              {isRsa ? 'RSA-OAEP-2048 · SHA-256' : 'PBKDF2-SHA256 · 150,000 ROUNDS'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {ALGO_OPTIONS.map((opt) => {
              const active = value.algorithm === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChange({ ...value, algorithm: opt.id })}
                  className={`px-2.5 py-2 rounded text-start border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#161922] border-[#10B981] text-[#ECEEF2]'
                      : 'bg-[#0D0F14] border-[#1E222B] text-[#949BA8] hover:border-[#2E3545] hover:text-[#ECEEF2]'
                  }`}
                >
                  <div className="text-xs font-mono font-medium truncate">{opt.label}</div>
                  <div className="text-[10px] font-mono text-[#5F6775] truncate mt-0.5">
                    {opt.spec}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!isRsa ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <label className="text-[#949BA8] font-medium flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#5F6775]" />
              {t.passphrase}
            </label>
            <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
              {value.password && (
                <span className={entropyTextColor}>
                  {entropy.bits} {t.bits} · {entropy.grade}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowGen((s) => !s)}
                className={`inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                  showGen ? 'text-[#10B981]' : 'text-[#949BA8] hover:text-[#ECEEF2]'
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                {t.generateKey}
              </button>
            </div>
          </div>

          <div className="flex items-stretch gap-1.5">
            <div className="relative flex-1">
              <input
                type={showPassword ? 'text' : 'password'}
                value={value.password}
                onChange={(e) => onChange({ ...value, password: e.target.value })}
                placeholder={t.passphrasePlaceholder}
                dir="ltr"
                className="w-full h-9 px-3 pe-16 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-xs font-mono text-[#ECEEF2] placeholder:text-[#4B5260] transition-colors"
              />
              <div className="absolute inset-y-0 end-1 flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handleCopyPwd}
                  title={t.copy}
                  disabled={!value.password}
                  className="p-1.5 text-[#5F6775] hover:text-[#ECEEF2] disabled:opacity-30 transition-colors cursor-pointer"
                >
                  {copiedPwd ? (
                    <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="p-1.5 text-[#5F6775] hover:text-[#ECEEF2] transition-colors cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGeneratePwd}
              title={t.generateKey}
              className="h-9 px-3 bg-[#161922] hover:bg-[#1E222B] border border-[#1E222B] hover:border-[#2E3545] rounded text-xs font-mono text-[#ECEEF2] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#10B981]" />
              <span className="hidden sm:inline">CSPRNG</span>
            </button>
          </div>

          {/* Hairline Entropy Bar */}
          <div className="h-[2px] w-full bg-[#1E222B] overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${entropyColor}`}
              style={{ width: `${entropyWidth}%` }}
            />
          </div>

          {/* Expandable CSPRNG Options */}
          {showGen && (
            <div className="p-3 bg-[#090A0D] border border-[#1E222B] rounded space-y-2.5">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[11px] font-mono text-[#949BA8] whitespace-nowrap">
                  {t.length}: <strong className="text-[#ECEEF2] tabular-nums">{genConfig.length}</strong>
                </span>
                <input
                  type="range"
                  min={12}
                  max={64}
                  value={genConfig.length}
                  onChange={(e) =>
                    setGenConfig((prev) => ({ ...prev, length: Number(e.target.value) }))
                  }
                  className="kx-slider flex-1"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      ['uppercase', t.upper],
                      ['lowercase', t.lower],
                      ['digits', t.digits],
                      ['symbols', t.symbols],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setGenConfig((prev) => ({ ...prev, [key]: !prev[key] }))
                      }
                      className={`px-2 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer ${
                        genConfig[key]
                          ? 'bg-[#10B981]/10 border-[#10B981]/60 text-[#10B981]'
                          : 'bg-[#111318] border-[#1E222B] text-[#5F6775]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleGeneratePwd}
                  className="px-3 py-1 text-[11px] font-mono font-medium bg-[#10B981] text-[#090A0D] rounded hover:bg-[#059669] transition-colors cursor-pointer"
                >
                  Generate
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <label className="text-[#949BA8] font-medium">
              {mode === 'embed' ? t.rsaPublicKey : t.rsaPrivateKey}
            </label>
            <div className="flex items-center gap-2">
              {sessionRsaKeys && (
                <span className="hidden sm:inline font-mono text-[10px] text-[#5F6775]">
                  FP: {sessionRsaKeys.fingerprintSha256.slice(0, 14)}
                </span>
              )}
              <button
                type="button"
                onClick={handleGenerateRsa}
                disabled={generatingRsa}
                className="px-2.5 py-1 text-[11px] font-mono bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] rounded text-[#10B981] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {generatingRsa ? t.rsaGenerating : t.rsaGenInline}
              </button>
            </div>
          </div>
          <textarea
            rows={4}
            dir="ltr"
            value={mode === 'embed' ? value.rsaPublicKeyPem : value.rsaPrivateKeyPem}
            onChange={(e) =>
              onChange(
                mode === 'embed'
                  ? { ...value, rsaPublicKeyPem: e.target.value }
                  : { ...value, rsaPrivateKeyPem: e.target.value }
              )
            }
            placeholder={
              mode === 'embed'
                ? '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----'
                : '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
            }
            className="w-full p-2.5 bg-[#090A0D] border border-[#1E222B] focus:border-[#10B981] focus:outline-none rounded text-[11px] font-mono text-[#ECEEF2] placeholder:text-[#4B5260] resize-y"
          />
        </div>
      )}
    </div>
  );
};
