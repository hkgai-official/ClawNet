import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../../../shared/domain/chat';

interface Props {
  message: ChatMessage;
  isOwn: boolean;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m > 0 ? `${m}'${String(r).padStart(2, '0')}"` : `${r}"`;
}

const BAR_COUNT = 12;
const FFT_SIZE = 64;           // → 32 bins; averaged into BAR_COUNT buckets
const BIN_HEIGHT_MIN = 3;
const BIN_HEIGHT_MAX = 14;

// Fallback decorative profile when paused or before the analyser produces
// its first sample. Stable per-bar so the resting bubble isn't flat.
const BASE_HEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) =>
  Math.max(BIN_HEIGHT_MIN, 4 + Math.sin(i * 0.6) * 3),
);

/**
 * Voice bubble: play/pause + 12-bar waveform + duration label.
 *
 * Bars are driven from real audio amplitude while playing: a
 * `MediaElementAudioSourceNode` routes the `<audio>` through an
 * `AnalyserNode` (fftSize=64 → 32 bins), averaged into BAR_COUNT buckets,
 * redrawn each rAF tick. When paused (or if analyser init fails — some
 * Chromium versions reject `createMediaElementSource` for cross-origin /
 * auth-bearing URLs), bars fall back to the static sine profile so the
 * bubble still has visual weight.
 *
 * Bars passed by the playhead remain full-opacity (UX hint "played");
 * future bars dim to 0.5–0.7. Mirrors macOS `VoiceMessageView.swift:48-61`
 * progress-driven heights, with the cosmetic sine replaced by real
 * amplitude via `AnalyserNode.getByteFrequencyData()`.
 */
export function VoiceMessageBubble({ message, isOwn }: Props) {
  const c = message.content as { url?: string | null; duration?: number | null };
  const declaredDuration = c.duration ?? 5;
  const width = Math.min(80 + declaredDuration * 8, 200);
  const tint = isOwn ? 'var(--color-on-status)' : 'var(--color-text-secondary)';
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [amplitudes, setAmplitudes] = useState<number[] | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqBufRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // AudioContext.close() returns a Promise; fire-and-forget on unmount.
      audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
      analyserRef.current = null;
      freqBufRef.current = null;
    };
  }, []);

  // While playing, the rAF loop drives both progress (currentTime/duration)
  // and amplitudes (binned FFT). Stops + clears on pause / unmount.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      const a = audioRef.current;
      if (a && a.duration > 0) {
        setProgress(Math.min(1, a.currentTime / a.duration));
      }
      const analyser = analyserRef.current;
      const buf = freqBufRef.current;
      if (analyser && buf) {
        analyser.getByteFrequencyData(buf);
        // 32 bins → BAR_COUNT buckets by even averaging. Map 0–255 byte
        // → pixel height in [BIN_HEIGHT_MIN, BIN_HEIGHT_MAX].
        const binsPerBar = Math.floor(buf.length / BAR_COUNT);
        const next: number[] = new Array(BAR_COUNT);
        for (let i = 0; i < BAR_COUNT; i++) {
          let sum = 0;
          for (let j = 0; j < binsPerBar; j++) sum += buf[i * binsPerBar + j] ?? 0;
          const avg = sum / Math.max(1, binsPerBar);
          next[i] = BIN_HEIGHT_MIN + (avg / 255) * (BIN_HEIGHT_MAX - BIN_HEIGHT_MIN);
        }
        setAmplitudes(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  const ensureAnalyser = () => {
    if (analyserRef.current || !audioRef.current) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // Init may throw on some Chromium versions for cross-origin or
      // auth-bearing media. Fall back to the decorative sine profile.
    }
  };

  const toggle = () => {
    if (!c.url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(c.url);
      audioRef.current.addEventListener('ended', () => {
        setPlaying(false);
        setProgress(0);
      });
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      ensureAnalyser();
      // Resume context if the browser suspended it before user gesture
      // (autoplay-policy). `toggle` itself is a gesture, so this is fine.
      if (audioCtxRef.current?.state === 'suspended') {
        void audioCtxRef.current.resume().catch(() => undefined);
      }
      void audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <button
      data-testid="voice-bubble"
      onClick={toggle}
      disabled={!c.url}
      aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      style={{
        width,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: isOwn ? 'var(--color-brand-500)' : 'var(--color-bg-surface-2)',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: c.url ? 'pointer' : 'default',
        color: isOwn ? 'var(--color-on-status)' : 'var(--color-text-primary)',
      }}
    >
      <span style={{ color: tint, fontSize: 14 }}>{playing ? '⏸' : '▶'}</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          flex: 1,
          height: 16,
        }}
      >
        {BASE_HEIGHTS.map((baseHeight, i) => {
          // Prefer real analyser amplitude while playing; baseHeight is
          // the rest / fallback. Past-playhead bars stay full-opacity.
          const liveHeight = playing && amplitudes ? amplitudes[i] : null;
          const renderedHeight = liveHeight ?? baseHeight;
          const barPos = (i + 0.5) / BAR_COUNT;
          const passed = playing && barPos <= progress;
          return (
            <div
              key={i}
              style={{
                width: 2.5,
                height: renderedHeight,
                background: tint,
                opacity: passed ? 1 : playing ? 0.7 : 0.5,
                borderRadius: 1,
                transition: 'height 60ms linear, opacity 120ms ease-out',
              }}
            />
          );
        })}
      </div>
      <span
        style={{
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          color: tint,
        }}
      >
        {formatDuration(declaredDuration)}
      </span>
    </button>
  );
}
