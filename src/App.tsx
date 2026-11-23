import React, { useEffect, useState } from 'react';
import {
  AudioLines,
  FileText,
  Film,
  Image as ImageIcon,
  Languages,
  Shield,
} from 'lucide-react';
import { RsaKeyPairPem } from './core/cryptoSuite';
import { Lang, TRANSLATIONS } from './i18n/translations';
import { AudioStegoModule } from './components/AudioStegoModule';
import { CryptoFormState } from './components/CryptoConfigPanel';
import { CryptoToolsModule } from './components/CryptoToolsModule';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ImageStegoModule } from './components/ImageStegoModule';
import { TextStegoModule } from './components/TextStegoModule';
import { VideoStegoModule } from './components/VideoStegoModule';

type ModuleId = 'text' | 'image' | 'audio' | 'video' | 'crypto';

const NAV_ITEMS: Array<{
  id: ModuleId;
  labelKey: 'navText' | 'navImage' | 'navAudio' | 'navVideo' | 'navCrypto';
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'text', labelKey: 'navText', icon: FileText },
  { id: 'image', labelKey: 'navImage', icon: ImageIcon },
  { id: 'audio', labelKey: 'navAudio', icon: AudioLines },
  { id: 'video', labelKey: 'navVideo', icon: Film },
  { id: 'crypto', labelKey: 'navCrypto', icon: Shield },
];

export default function App() {
  const [activeModule, setActiveModule] = useState<ModuleId>('text');
  const [lang, setLang] = useState<Lang>('en');
  const [sessionRsaKeys, setSessionRsaKeys] = useState<RsaKeyPairPem | null>(null);
  const [cryptoState, setCryptoState] = useState<CryptoFormState>({
    algorithm: 'AES-256-GCM',
    password: '',
    rsaPublicKeyPem: '',
    rsaPrivateKeyPem: '',
  });

  const t = TRANSLATIONS[lang];

  useEffect(() => {
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#090A0D] text-[#ECEEF2] flex flex-col">
        {/* Compact Industrial Top Command Bar (Strict 3-Zone Single Row) */}
        <header className="sticky top-0 z-30 bg-[#090A0D]/95 backdrop-blur-sm border-b border-[#1E222B]">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sm:gap-8">
            {/* Zone 1: Brand Wordmark */}
            <div className="font-mono text-xs sm:text-sm font-bold tracking-tight text-[#ECEEF2] whitespace-nowrap shrink-0" dir="ltr">
              KEYXERXES <span className="text-[#10B981]">//</span> OMNI-CRYPT ULTRA
            </div>

            {/* Zone 2: Module Navigation */}
            <nav
              aria-label="Steganography and Cryptography Engines"
              className="hidden md:flex items-center gap-1"
            >
              {NAV_ITEMS.map(({ id, labelKey, icon: Icon }) => {
                const active = activeModule === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveModule(id)}
                    className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[#161922] text-[#10B981] border border-[#2E3545]'
                        : 'text-[#949BA8] hover:text-[#ECEEF2] border border-transparent'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{t[labelKey]}</span>
                  </button>
                );
              })}
            </nav>

            {/* Zone 3: Bilingual LTR / RTL Action */}
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setLang((prev) => (prev === 'en' ? 'fa' : 'en'))}
                className="h-8 px-3 bg-[#111318] hover:bg-[#161922] border border-[#1E222B] hover:border-[#2E3545] rounded text-xs font-mono text-[#ECEEF2] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Languages className="w-3.5 h-3.5 text-[#10B981]" />
                <span>{lang === 'en' ? 'فارسی' : 'EN'}</span>
              </button>
            </div>
          </div>

          {/* Mobile Horizontal Module Strip */}
          <div className="md:hidden border-t border-[#1E222B] px-3 py-1.5 flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map(({ id, labelKey, icon: Icon }) => {
              const active = activeModule === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveModule(id)}
                  className={`px-2.5 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#161922] text-[#10B981] border border-[#2E3545]'
                      : 'text-[#949BA8] hover:text-[#ECEEF2] border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{t[labelKey]}</span>
                </button>
              );
            })}
          </div>
        </header>

        {/* Main Workstation Viewport */}
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6">
          {activeModule === 'text' && (
            <TextStegoModule
              t={t}
              cryptoState={cryptoState}
              onCryptoChange={setCryptoState}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={setSessionRsaKeys}
            />
          )}
          {activeModule === 'image' && (
            <ImageStegoModule
              t={t}
              cryptoState={cryptoState}
              onCryptoChange={setCryptoState}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={setSessionRsaKeys}
            />
          )}
          {activeModule === 'audio' && (
            <AudioStegoModule
              t={t}
              cryptoState={cryptoState}
              onCryptoChange={setCryptoState}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={setSessionRsaKeys}
            />
          )}
          {activeModule === 'video' && (
            <VideoStegoModule
              t={t}
              cryptoState={cryptoState}
              onCryptoChange={setCryptoState}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={setSessionRsaKeys}
            />
          )}
          {activeModule === 'crypto' && (
            <CryptoToolsModule
              t={t}
              cryptoState={cryptoState}
              onCryptoChange={setCryptoState}
              sessionRsaKeys={sessionRsaKeys}
              onSessionRsaKeysChange={setSessionRsaKeys}
            />
          )}
        </main>

        {/* Minimal Quiet Footer */}
        <footer className="border-t border-[#1E222B] py-4 px-4 sm:px-6">
          <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] font-mono text-[#5F6775]">
            <span dir="ltr">KEYXERXES // OMNI-CRYPT ULTRA · MIT License</span>
            <span>Zero-Knowledge · 100% Client-Side Web Crypto Execution</span>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
