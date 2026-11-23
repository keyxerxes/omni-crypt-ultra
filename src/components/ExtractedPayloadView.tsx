import React, { useState } from 'react';
import { Check, Copy, Download, FileCode2, FileText } from 'lucide-react';
import { DecodedPayload, formatBytes } from '../core/payloadFormat';
import { Translations } from '../i18n/translations';

interface ExtractedPayloadViewProps {
  t: Translations;
  payload: DecodedPayload;
  metaLine: string;
}

export const ExtractedPayloadView: React.FC<ExtractedPayloadViewProps> = ({
  t,
  payload,
  metaLine,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyText = async () => {
    if (payload.kind !== 'text') return;
    await navigator.clipboard.writeText(payload.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownloadFile = () => {
    if (payload.kind !== 'file') return;
    const blob = new Blob([new Uint8Array(payload.bytes)], {
      type: payload.mimeType || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="bg-[#090A0D] border border-[#10B981]/50 rounded overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-[#10B981]/10 border-b border-[#10B981]/30">
        <div className="flex items-center gap-2 text-xs font-mono text-[#10B981]">
          {payload.kind === 'text' ? (
            <FileText className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <FileCode2 className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="font-semibold">{t.extractedSecret}</span>
        </div>
        <span className="text-[11px] font-mono text-[#949BA8] tabular-nums">{metaLine}</span>
      </div>

      {payload.kind === 'text' ? (
        <div className="p-3.5 space-y-3">
          <pre className="w-full max-h-64 overflow-auto text-xs font-mono text-[#ECEEF2] whitespace-pre-wrap break-words leading-relaxed">
            {payload.text}
          </pre>
          <div className="flex items-center justify-between pt-2 border-t border-[#1E222B]">
            <span className="text-[11px] font-mono text-[#5F6775] tabular-nums">
              UTF-8 · {formatBytes(payload.byteLength)}
            </span>
            <button
              type="button"
              onClick={handleCopyText}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] rounded text-[#ECEEF2] transition-colors cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#10B981]" />
                  {t.copied}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {t.copy}
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="text-sm font-mono font-medium text-[#ECEEF2] truncate">
              {payload.fileName}
            </div>
            <div className="text-[11px] font-mono text-[#949BA8] tabular-nums">
              {payload.mimeType} · {formatBytes(payload.byteLength)}
            </div>
          </div>
          <button
            type="button"
            onClick={handleDownloadFile}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono font-medium bg-[#10B981] hover:bg-[#059669] text-[#090A0D] rounded transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            {t.downloadExtractedFile}
          </button>
        </div>
      )}
    </div>
  );
};
