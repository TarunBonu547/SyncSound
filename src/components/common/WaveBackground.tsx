import { useEffect, useRef } from 'react';

type WaveBackgroundProps = {
  /** Whether music is currently playing - drives animation intensity. */
  playing?: boolean;
  /** Visual variant to tune opacity/placement per container. */
  variant?: 'card' | 'chat' | 'mini';
  className?: string;
};

type Layer = {
  color: string;
  amplitude: number;
  wavelength: number;
  speed: number;
  y: number;
  lineWidth: number;
  alpha: number;
};

const PALETTE = {
  peach: '255, 197, 161',   // #ffc5a1
  coral: '255, 162, 127',   // #ffa27f
  rose: '248, 183, 197',    // #f8b7c5
  lavender: '217, 202, 255', // #d9caff
};

function layersFor(variant: WaveBackgroundProps['variant']): Layer[] {
  const base = variant === 'mini' ? 0.55 : variant === 'chat' ? 0.7 : 1;
  return [
    { color: PALETTE.lavender, amplitude: 10 * base, wavelength: 180, speed: 0.00035, y: 0.62, lineWidth: 0, alpha: 0.22 },
    { color: PALETTE.rose,     amplitude: 8 * base,  wavelength: 140, speed: 0.00045, y: 0.68, lineWidth: 0, alpha: 0.18 },
    { color: PALETTE.peach,    amplitude: 7 * base,  wavelength: 120, speed: 0.00055, y: 0.74, lineWidth: 0, alpha: 0.2 },
    { color: PALETTE.coral,    amplitude: 5 * base,  wavelength: 100, speed: 0.00065, y: 0.8,  lineWidth: 0, alpha: 0.14 },
  ];
}

/**
 * Soft, layered, playback-responsive wave background.
 *
 * Uses a canvas animation (no audio analyser access available from the YouTube
 * IFrame player) with gentle motion when paused and more active motion while
 * playing. Positioned behind content and clipped by the parent container.
 */
export default function WaveBackground({ playing = false, variant = 'card', className }: WaveBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(playing);
  const intensityRef = useRef(playing ? 1 : 0.25);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (ro && canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', resize);

    const layers = layersFor(variant);
    let t0 = performance.now();

    const draw = (now: number) => {
      const dt = now - t0;
      t0 = now;

      // Smoothly approach target intensity (playback-responsive fallback).
      const target = playingRef.current ? 1 : 0.22;
      const ease = 1 - Math.pow(0.001, dt / 1000); // ~time-based smoothing
      intensityRef.current += (target - intensityRef.current) * Math.min(1, Math.max(0.02, ease * 3));
      const intensity = intensityRef.current;

      ctx.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        const phase = now * l.speed * (0.6 + intensity * 0.9) + i * 1.3;
        const amp = l.amplitude * (0.45 + intensity * 0.85);
        const baseY = height * l.y;

        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(0, baseY);
        for (let x = 0; x <= width; x += 4) {
          const nx = x / l.wavelength;
          const y =
            baseY +
            Math.sin(nx + phase) * amp +
            Math.sin(nx * 0.6 - phase * 1.2) * amp * 0.35;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, baseY - amp * 2, 0, height);
        const a = l.alpha * (0.7 + intensity * 0.5);
        grad.addColorStop(0, `rgba(${l.color}, ${a})`);
        grad.addColorStop(1, `rgba(${l.color}, 0)`);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      if (ro) ro.disconnect();
    };
  }, [variant]);

  const classes = ['wave-bg', variant ? `wave-bg--${variant}` : '', className || ''].filter(Boolean).join(' ');

  return <canvas ref={canvasRef} className={classes} aria-hidden="true" />;
}