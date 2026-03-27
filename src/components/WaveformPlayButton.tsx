import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const SEGMENT_COUNT = 96;

interface WaveformPlayButtonProps {
  src: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  autoPlay?: boolean;
  intensity?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function polarToCartesian(radius: number, angle: number, center: number) {
  return {
    x: center + radius * Math.cos(angle - Math.PI / 2),
    y: center + radius * Math.sin(angle - Math.PI / 2),
  };
}

function createCirclePath(size: number, radius: number, count = SEGMENT_COUNT) {
  const center = size / 2;
  const commands: string[] = [];

  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * FULL_CIRCLE;
    const point = polarToCartesian(radius, angle, center);
    commands.push(`${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  }

  return `${commands.join(' ')} Z`;
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

export function WaveformPlayButton({
  src,
  size = 80,
  strokeWidth = 4,
  className,
  autoPlay = false,
  intensity = 1,
  onPlay,
  onPause,
  onEnd,
}: WaveformPlayButtonProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const smoothFrequencyRef = useRef<Float32Array>(new Float32Array(SEGMENT_COUNT));
  const activityRef = useRef(0);
  const targetActivityRef = useRef(0);
  const smoothedLevelRef = useRef(0);
  const basePath = useMemo(() => {
    const center = size / 2;
    const radius = center - strokeWidth * 0.6 - 1;
    return createCirclePath(size, radius);
  }, [size, strokeWidth]);

  const prefersReducedMotion = usePrefersReducedMotion();
  const [isPlaying, setIsPlaying] = useState(false);

  const composedClassName = ['waveform-play-button', className].filter(Boolean).join(' ');
  const hasSource = Boolean(src);

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current && typeof window !== 'undefined') {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
  }, []);

  const teardownAudioGraph = useCallback(() => {
    sourceNodeRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceNodeRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
  }, []);

  const buildWaveformPath = useCallback(
    (timeSeconds: number) => {
      const center = size / 2;
      const safeRadius = center - strokeWidth * 0.6 - 1;
      const minRadius = center - strokeWidth * 1.7 - 14;
      const maxAmplitude = Math.max(size * 0.14, 8) * clamp(intensity, 0.35, 2.5);
      const activity = activityRef.current;
      const commands = new Array<string>(SEGMENT_COUNT + 1);

      for (let index = 0; index <= SEGMENT_COUNT; index += 1) {
        const i = index % SEGMENT_COUNT;
        const angle = (index / SEGMENT_COUNT) * FULL_CIRCLE;

        const signal = smoothFrequencyRef.current[i] ?? 0;
        const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * 2.1 + i * 0.17);
        const reducedSignal = prefersReducedMotion ? pulse * 0.2 : signal;
        const offset = reducedSignal * maxAmplitude * activity;
        const radius = clamp(safeRadius + offset, minRadius, center - strokeWidth * 0.45);
        const point = polarToCartesian(radius, angle, center);

        commands[index] = `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
      }

      return `${commands.join(' ')} Z`;
    },
    [intensity, prefersReducedMotion, size, strokeWidth],
  );

  const draw = useCallback(
    (now: number) => {
      const pathElement = pathRef.current;

      if (!pathElement) {
        return;
      }

      const analyser = analyserRef.current;
      const data = dataRef.current;
      const isReactive = Boolean(analyser && data && isPlaying && !prefersReducedMotion);

      if (isReactive && analyser && data) {
        analyser.getByteFrequencyData(data as unknown as Uint8Array<ArrayBuffer>);
      }

      targetActivityRef.current = isPlaying ? 1 : 0;
      activityRef.current += (targetActivityRef.current - activityRef.current) * 0.1;

      for (let index = 0; index < SEGMENT_COUNT; index += 1) {
        const mappedBin = Math.floor((index / SEGMENT_COUNT) * (data?.length ?? SEGMENT_COUNT));
        const measured = isReactive && data ? (data[mappedBin] ?? 0) / 255 : 0;

        smoothedLevelRef.current = smoothedLevelRef.current * 0.94 + measured * 0.06;
        const fallbackWave =
          0.18 +
          0.14 * Math.sin(now / 420 + index * 0.22) +
          0.08 * Math.cos(now / 570 + index * 0.31);
        const target = isReactive ? measured : fallbackWave;

        smoothFrequencyRef.current[index] =
          smoothFrequencyRef.current[index] * 0.84 + target * 0.16;
      }

      if (activityRef.current < 0.015 && !isPlaying) {
        pathElement.setAttribute('d', basePath);
        stopAnimation();
        return;
      }

      pathElement.setAttribute('d', buildWaveformPath(now / 1000));
      animationFrameRef.current = window.requestAnimationFrame(draw);
    },
    [basePath, buildWaveformPath, isPlaying, prefersReducedMotion, stopAnimation],
  );

  const ensureAudioContext = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!audioRef.current) {
      const element = document.createElement('audio');
      element.preload = 'metadata';
      element.crossOrigin = 'anonymous';
      audioRef.current = element;
    }

    if (audioContextRef.current) {
      return;
    }

    const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!Context) {
      return;
    }

    const context = new Context();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;

    const sourceNode = context.createMediaElementSource(audioRef.current);
    sourceNode.connect(analyser);
    analyser.connect(context.destination);

    audioContextRef.current = context;
    analyserRef.current = analyser;
    sourceNodeRef.current = sourceNode;
    dataRef.current = new Uint8Array(analyser.frequencyBinCount);
  }, []);

  const startAnimation = useCallback(() => {
    if (typeof window === 'undefined' || animationFrameRef.current) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  const handlePause = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.pause();
    setIsPlaying(false);
    onPause?.();
    startAnimation();
  }, [onPause, startAnimation]);

  const handlePlay = useCallback(async () => {
    if (!hasSource) {
      return;
    }

    ensureAudioContext();
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.src = src;

    try {
      await audioContextRef.current?.resume();
      await audio.play();
      setIsPlaying(true);
      onPlay?.();
      startAnimation();
    } catch {
      // Keep fallback visuals if browser blocks autoplay or context policies.
      setIsPlaying(false);
      startAnimation();
    }
  }, [ensureAudioContext, hasSource, onPlay, src, startAnimation]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      handlePause();
      return;
    }

    void handlePlay();
  }, [handlePause, handlePlay, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const ended = () => {
      setIsPlaying(false);
      onEnd?.();
      startAnimation();
    };

    audio.addEventListener('ended', ended);
    return () => audio.removeEventListener('ended', ended);
  }, [onEnd, startAnimation]);

  useEffect(() => {
    ensureAudioContext();

    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.src = src;
    setIsPlaying(false);
    activityRef.current = 0;
    targetActivityRef.current = 0;
    smoothFrequencyRef.current.fill(0);

    if (!src) {
      audio.removeAttribute('src');
    }

    if (autoPlay && src) {
      void handlePlay();
    }
  }, [autoPlay, ensureAudioContext, handlePlay, src]);

  useEffect(() => {
    const pathElement = pathRef.current;

    if (!pathElement) {
      return;
    }

    pathElement.setAttribute('d', basePath);
  }, [basePath]);

  useEffect(() => {
    return () => {
      stopAnimation();

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }

      teardownAudioGraph();

      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, [stopAnimation, teardownAudioGraph]);

  return (
    <button
      aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
      className={composedClassName}
      disabled={!hasSource}
      onClick={togglePlayback}
      type="button"
    >
      <svg
        aria-hidden="true"
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
          d={basePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />

        <circle
          cx={size / 2}
          cy={size / 2}
          fill="rgba(255, 255, 255, 0.86)"
          r={Math.max(size * 0.24, 16)}
        />

        <g className={`waveform-play-button-icon ${isPlaying ? 'is-playing' : ''}`}>
          <polygon
            className="waveform-play-icon"
            points={`${size * 0.47},${size * 0.41} ${size * 0.47},${size * 0.59} ${size * 0.61},${size * 0.5}`}
          />
          <rect
            className="waveform-pause-icon waveform-pause-left"
            height={size * 0.2}
            rx={size * 0.015}
            width={size * 0.055}
            x={size * 0.455}
            y={size * 0.4}
          />
          <rect
            className="waveform-pause-icon waveform-pause-right"
            height={size * 0.2}
            rx={size * 0.015}
            width={size * 0.055}
            x={size * 0.54}
            y={size * 0.4}
          />
        </g>
      </svg>
    </button>
  );
}
