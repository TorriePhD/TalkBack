import { useEffect, useRef } from 'react';
import { AUDIO_ENERGY_EVENT, type AudioEnergyDetail } from '../audio/audioEnergyBus';

const BASE_BACKGROUND = '#050A1A';
const NEON_COLORS = ['#00E5FF', '#0088FF', '#4B00FF', '#A000FF', '#FF2D8D'] as const;
const BLOB_COUNT = 7;
const TARGET_FRAME_MS = 1000 / 30;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function NeonAudioBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const energyTargetRef = useRef(0);
  const energyRef = useRef(0);
  const lastSignalAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleEnergy = (event: Event) => {
      const customEvent = event as CustomEvent<AudioEnergyDetail>;
      if (!customEvent.detail) {
        return;
      }
      lastSignalAtRef.current = performance.now();
      energyTargetRef.current = customEvent.detail.energy;
    };

    window.addEventListener(AUDIO_ENERGY_EVENT, handleEnergy as EventListener);
    return () => {
      window.removeEventListener(AUDIO_ENERGY_EVENT, handleEnergy as EventListener);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') {
      return;
    }

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const blobs = Array.from({ length: BLOB_COUNT }, (_, index) => {
      const seed = index / BLOB_COUNT;
      return {
        x: 0.1 + (seed * 0.9) % 1,
        y: 0.12 + ((seed * 1.3) % 0.86),
        radius: 0.2 + (index % 4) * 0.08,
        speed: 0.12 + (index % 5) * 0.03,
        phase: index * 1.47,
        color: NEON_COLORS[index % NEON_COLORS.length],
      };
    });

    const handleResize = () => {
      const devicePixelRatio = clamp(window.devicePixelRatio || 1, 1, 1.5);
      const sizeScale = window.innerWidth < 720 ? 0.55 : 0.7;
      canvas.width = Math.floor(window.innerWidth * sizeScale * devicePixelRatio);
      canvas.height = Math.floor(window.innerHeight * sizeScale * devicePixelRatio);
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    let rafId: number | null = null;
    let lastDraw = 0;

    const draw = (now: number) => {
      if (!lastDraw || now - lastDraw >= TARGET_FRAME_MS) {
        const width = canvas.width;
        const height = canvas.height;

        if (now - lastSignalAtRef.current > 260) {
          energyTargetRef.current *= 0.94;
        }
        const smoothing = prefersReducedMotion ? 0.08 : 0.15;
        energyRef.current += (energyTargetRef.current - energyRef.current) * smoothing;
        const energy = clamp(energyRef.current, 0, 1);
        const energyBias = Math.max(0, (energy - 0.26) / 0.74);

        context.clearRect(0, 0, width, height);
        context.fillStyle = BASE_BACKGROUND;
        context.fillRect(0, 0, width, height);

        const drift = prefersReducedMotion ? 0 : now * 0.00012;
        const colorBlend = clamp(0.22 + energyBias * 0.72, 0.22, 0.95);

        for (let i = 0; i < blobs.length; i += 1) {
          const blob = blobs[i];
          const px = (blob.x + Math.sin(drift * blob.speed + blob.phase) * 0.08) * width;
          const py = (blob.y + Math.cos(drift * (blob.speed + 0.06) + blob.phase) * 0.08) * height;
          const maxDimension = Math.max(width, height);
          const radiusBase = maxDimension * blob.radius;
          const radius = radiusBase * (1 + energy * 0.12);
          const alpha = 0.08 + energy * 0.12 + (i % 3) * 0.015;

          const gradient = context.createRadialGradient(px, py, 0, px, py, radius);
          gradient.addColorStop(0, hexToRgba(blob.color, alpha));
          gradient.addColorStop(0.45, hexToRgba(blob.color, alpha * 0.55));
          gradient.addColorStop(1, hexToRgba(blob.color, 0));

          context.globalCompositeOperation = 'lighter';
          context.fillStyle = gradient;
          context.fillRect(px - radius, py - radius, radius * 2, radius * 2);
        }

        const centerX = width * (0.38 + Math.sin(drift * 0.84) * 0.05);
        const centerY = height * (0.58 + Math.cos(drift * 1.1) * 0.03);
        const coreRadius = Math.max(width, height) * (0.48 + energy * 0.08);
        const activeColor = NEON_COLORS[Math.round(colorBlend * (NEON_COLORS.length - 1))];
        const overlay = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
        overlay.addColorStop(0, hexToRgba(activeColor, 0.08 + energy * 0.22));
        overlay.addColorStop(0.42, hexToRgba('#4B00FF', 0.06 + energy * 0.09));
        overlay.addColorStop(1, 'rgba(5, 10, 26, 0)');

        context.fillStyle = overlay;
        context.fillRect(centerX - coreRadius, centerY - coreRadius, coreRadius * 2, coreRadius * 2);
        context.globalCompositeOperation = 'source-over';

        lastDraw = now;
      }

      rafId = window.requestAnimationFrame(draw);
    };

    rafId = window.requestAnimationFrame(draw);

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div aria-hidden="true" className="neon-bg">
      <canvas className="neon-bg-canvas" ref={canvasRef} />
      <div className="neon-bg-field" />
    </div>
  );
}
