import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2 } from 'lucide-react';

interface WaveformPlayerProps {
  audioUrl: string;
  peaks: number[];
  durationSec: number;
  label?: string;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.0';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

export const WaveformPlayer: React.FC<WaveformPlayerProps> = ({
  audioUrl,
  peaks,
  durationSec,
  label,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDur, setTotalDur] = useState(durationSec);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setTotalDur(durationSec);
  }, [audioUrl, durationSec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(200, Math.floor(rect.width));
    const height = Math.max(56, Math.floor(rect.height));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Center zero-crossing reference line
    ctx.strokeStyle = '#1E222B';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    const count = peaks.length || 1;
    const barSlot = width / count;
    const barWidth = Math.max(1.5, barSlot - 1);
    const progressRatio = totalDur > 0 ? Math.min(1, currentTime / totalDur) : 0;

    for (let i = 0; i < count; i++) {
      const amp = Math.max(0.03, peaks[i] ?? 0);
      const barH = amp * (height - 8);
      const x = i * barSlot;
      const y = (height - barH) / 2;
      const played = i / count <= progressRatio;
      ctx.fillStyle = played ? '#10B981' : '#353D4F';
      ctx.fillRect(x, y, barWidth, barH);
    }

    // Playhead vertical hairline
    if (progressRatio > 0) {
      const px = progressRatio * width;
      ctx.strokeStyle = '#ECEEF2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
  }, [peaks, currentTime, totalDur]);

  const togglePlay = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      try {
        await el.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const el = audioRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas || totalDur <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * totalDur;
    setCurrentTime(el.currentTime);
  };

  return (
    <div className="bg-[#090A0D] border border-[#1E222B] rounded p-3 space-y-2.5" dir="ltr">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) {
            setTotalDur(e.currentTarget.duration);
          }
        }}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#949BA8]">
        <div className="flex items-center gap-2 min-w-0">
          <Volume2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
          <span className="truncate">{label || 'PCM 16-BIT STEREO'}</span>
        </div>
        <span className="tabular-nums text-[#ECEEF2] shrink-0">
          {formatTime(currentTime)} / {formatTime(totalDur)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="w-9 h-9 rounded bg-[#161922] hover:bg-[#1E222B] border border-[#2E3545] flex items-center justify-center text-[#10B981] transition-colors cursor-pointer shrink-0"
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-[1px]" />}
        </button>

        <canvas
          ref={canvasRef}
          onClick={handleSeek}
          className="w-full h-14 cursor-pointer block"
        />
      </div>
    </div>
  );
};
