import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const TARGET_FRAME_MS = 1000 / 48;

interface WaveformPlayButtonProps {
  src: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  intensity?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toPolarPoint(radius: number, theta: number, center: number) {
  return {
    x: center + radius * Math.cos(theta - Math.PI / 2),
    y: center + radius * Math.sin(theta - Math.PI / 2),
  };
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(media.matches);

    update();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

function buildCircularPath(size: number, strokeWidth: number, radii: number[]) {
  const center = size / 2;
  const segmentTotal = radii.length;
  const commands = new Array<string>(segmentTotal + 1);

  for (let i = 0; i <= segmentTotal; i += 1) {
    const index = i % segmentTotal;
    const theta = (index / segmentTotal) * FULL_CIRCLE;
    const point = toPolarPoint(radii[index], theta, center);
    commands[i] = `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  return `${commands.join(' ')} Z`;
}

function getBaseRadius(size: number, strokeWidth: number, intensity: number) {
  const center = size / 2;
  const safeOuterRadius = center - strokeWidth * 0.5 - 0.5;
  const maxAmplitude = 13 * clamp(intensity, 0.4, 2.2);
  return {
    baseRadius: clamp(safeOuterRadius - maxAmplitude - 1, strokeWidth + 3, safeOuterRadius),
    safeOuterRadius,
  };
}

export function WaveformPlayButton({
  src,
  size = 80,
  strokeWidth = 4,
  className,
  autoPlay = false,
  onPlay,
  onPause,
  onEnd,
  intensity = 1,
}: WaveformPlayButtonProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frequencyRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothedRef = useRef<Float32Array | null>(null);
  const motionTargetRef = useRef(0);
  const motionProgressRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const segmentCount = useMemo(() => (prefersReducedMotion ? 84 : 120), [prefersReducedMotion]);

  const initialPath = useMemo(() => {
    const { baseRadius } = getBaseRadius(size, strokeWidth, intensity);
    const radii = Array.from({ length: segmentCount }, () => baseRadius);
    return buildCircularPath(size, strokeWidth, radii);
  }, [segmentCount, size, strokeWidth, intensity]);

  useEffect(() => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = src;
    audio.crossOrigin = 'anonymous';

    const handlePlay = () => {
      motionTargetRef.current = 1;
      setIsPlaying(true);
      onPlay?.();
    };

    const handlePause = () => {
      motionTargetRef.current = 0;
      setIsPlaying(false);
      onPause?.();
    };

    const handleEnded = () => {
      motionTargetRef.current = 0;
      setIsPlaying(false);
      onEnd?.();
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [src, onEnd, onPause, onPlay]);

  useEffect(() => {
    if (!autoPlay || !audioRef.current) {
      return;
    }

    void audioRef.current.play().catch(() => {
      // Ignore autoplay restrictions.
    });
  }, [autoPlay, src]);

  const initializeAudioGraph = () => {
    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') {
      return;
    }

    if (!audioContextRef.current) {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      audioContextRef.current = new AudioContextCtor();
    }

    if (!analyserRef.current && audioContextRef.current) {
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      analyserRef.current = analyser;
      frequencyRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
      smoothedRef.current = new Float32Array(segmentCount);
    }

    if (!sourceRef.current && analyserRef.current && audioContextRef.current) {
      sourceRef.current = audioContextRef.current.createMediaElementSource(audio);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
  };

  useEffect(() => {
    if (!smoothedRef.current || smoothedRef.current.length === segmentCount) {
      return;
    }

    smoothedRef.current = new Float32Array(segmentCount);
  }, [segmentCount]);

  useEffect(() => {
    const pathElement = pathRef.current;
    if (!pathElement || typeof window === 'undefined') {
      return;
    }

    const draw = (now: number) => {
      if (!lastFrameAtRef.current || now - lastFrameAtRef.current > TARGET_FRAME_MS) {
        const { baseRadius, safeOuterRadius } = getBaseRadius(size, strokeWidth, intensity);
        const progressTarget = motionTargetRef.current;
        const previousProgress = motionProgressRef.current;
        const easing = progressTarget > previousProgress ? 0.16 : 0.1;
        const progress = previousProgress + (progressTarget - previousProgress) * easing;
        motionProgressRef.current = progress;

        const radii = new Array<number>(segmentCount);
        const analyser = analyserRef.current;
        const frequencyData = frequencyRef.current;
        const smoothed = smoothedRef.current;

        if (analyser && frequencyData && smoothed && isPlaying && !prefersReducedMotion) {
          analyser.getByteFrequencyData(frequencyData);
          const amplitude = 20 * intensity * progress;
          const minRadius = strokeWidth * 0.9;

          for (let i = 0; i < segmentCount; i += 1) {
            const frequencyIndex = Math.floor((i / segmentCount) * frequencyData.length);
            const normalized = frequencyData[frequencyIndex] / 255;
            const current = smoothed[i] ?? 0;
            const smoothValue = current + (normalized - current) * 0.24;
            smoothed[i] = smoothValue;

            const theta = (i / segmentCount) * FULL_CIRCLE;
            const spatialWeight = 0.86 + 0.14 * Math.cos(theta * 2 - now * 0.0008);
            const drift = 0.88 + 0.12 * Math.sin(now * 0.0014 + theta * 4.8);
            const offset = amplitude * smoothValue * spatialWeight * drift;
            radii[i] = clamp(baseRadius + offset, minRadius, safeOuterRadius);
          }
        } else {
          for (let i = 0; i < segmentCount; i += 1) {
            const subtlePulse = prefersReducedMotion
              ? 0.85 + 0.15 * Math.sin(now * 0.001 + i * 0.11)
              : 1;
            const settle = (1.8 + 2.2 * motionProgressRef.current) * subtlePulse;
            radii[i] = clamp(baseRadius + settle, strokeWidth * 0.9, safeOuterRadius);
          }
        }

        pathElement.setAttribute('d', buildCircularPath(size, strokeWidth, radii));
        lastFrameAtRef.current = now;
      }

      rafRef.current = window.requestAnimationFrame(draw);
    };

    rafRef.current = window.requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
    };
  }, [initialPath, intensity, isPlaying, prefersReducedMotion, segmentCount, size, strokeWidth]);

  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused || audio.ended) {
      initializeAudioGraph();

      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      await audio.play();
      return;
    }

    audio.pause();
  };

  const composedClassName = ['waveform-play-button', isPlaying ? 'is-playing' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
      className={composedClassName}
      onClick={() => {
        void togglePlayback().catch(() => {
          // Playback can fail without user gesture or with invalid audio URL.
        });
      }}
      style={{ '--wpb-size': `${size}px` } as CSSProperties}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="waveform-play-button-svg"
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={size * 0.08}
            x2={size * 0.92}
            y1={size * 0.12}
            y2={size * 0.88}
          >
            <stop offset="0%" stopColor="#2ad6d9" />
            <stop offset="18%" stopColor="#1b8dff" />
            <stop offset="36%" stopColor="#6b5cff" />
            <stop offset="54%" stopColor="#f12cb4" />
            <stop offset="74%" stopColor="#ff7b4f" />
            <stop offset="100%" stopColor="#b6de3f" />
          </linearGradient>
        </defs>

        <path
          ref={pathRef}
          d={initialPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />
      </svg>

      <span className="waveform-play-button-icon" aria-hidden="true">
        <span className="waveform-icon-play" />
        <span className="waveform-icon-pause">
          <span />
          <span />
        </span>
      </span>
    </button>
  );
}
