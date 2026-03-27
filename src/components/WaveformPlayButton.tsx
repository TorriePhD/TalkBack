import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const SAMPLE_COUNT = 180;
const MAX_AMPLITUDE = 8;
const MORPH_DURATION_MS = 300;

let activeAudioElement: HTMLAudioElement | null = null;

export interface WaveformPlayButtonProps {
  src: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onEnd?: () => void;
  variant?: 'compact' | 'full';
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toPolarPoint(radius: number, theta: number, center: number) {
  return {
    x: center + radius * Math.cos(theta - Math.PI / 2),
    y: center + radius * Math.sin(theta - Math.PI / 2),
  };
}

function buildWavePath(
  size: number,
  strokeWidth: number,
  morphMix: number,
  timeSeconds: number,
  energy: number,
  reducedMotion: boolean,
) {
  const center = size / 2;
  const outerRadius = center - strokeWidth * 0.5 - 1;
  const amplitude = MAX_AMPLITUDE * morphMix * (0.45 + energy * 1.2);
  const minRadius = strokeWidth;
  const maxRadius = outerRadius;
  const commands: string[] = [];

  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    const theta = (index / SAMPLE_COUNT) * FULL_CIRCLE;

    // Polar waveform: mix controls circle -> waveform morph, energy scales loudness.
    const carrierPhase = reducedMotion
      ? theta * 7
      : theta * 9 + timeSeconds * 2.6 + energy * 1.5;
    const detailPhase = reducedMotion ? theta * 11 : theta * 15 - timeSeconds * 4.3;
    const wave =
      Math.sin(carrierPhase) * 0.68 +
      Math.sin(detailPhase) * 0.22 +
      Math.sin(theta * 4 - timeSeconds * 1.8) * 0.1;

    const radius = clamp(outerRadius - amplitude * wave, minRadius, maxRadius);
    const point = toPolarPoint(radius, theta, center);
    const command = index === 0 ? 'M' : 'L';

    commands.push(`${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
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
    const onChange = () => setPrefersReducedMotion(mediaQuery.matches);

    onChange();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange);

      return () => {
        mediaQuery.removeEventListener('change', onChange);
      };
    }

    mediaQuery.addListener(onChange);

    return () => {
      mediaQuery.removeListener(onChange);
    };
  }, []);

  return prefersReducedMotion;
}

export function WaveformPlayButton({
  src,
  size = 72,
  strokeWidth = 4,
  className,
  autoPlay = false,
  onPlay,
  onEnd,
  variant = 'full',
}: WaveformPlayButtonProps) {
  const gradientId = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const morphMixRef = useRef(0);
  const energyRef = useRef(0.25);
  const startedAtRef = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const buttonSize = useMemo(() => (variant === 'compact' ? Math.max(46, size - 14) : size), [size, variant]);

  const draw = useCallback(
    (timestamp: number) => {
      const pathElement = pathRef.current;
      const audioElement = audioRef.current;

      if (!pathElement || !audioElement) {
        return;
      }

      const targetMorph = !audioElement.paused && !audioElement.ended ? 1 : 0;
      const morphStep = 16 / MORPH_DURATION_MS;
      morphMixRef.current += (targetMorph - morphMixRef.current) * morphStep;

      const analyser = analyserRef.current;
      if (analyser && dataRef.current) {
        analyser.getByteTimeDomainData(dataRef.current);
        let sumSquares = 0;

        for (let index = 0; index < dataRef.current.length; index += 1) {
          const value = (dataRef.current[index] - 128) / 128;
          sumSquares += value * value;
        }

        const rms = Math.sqrt(sumSquares / dataRef.current.length);
        energyRef.current += (clamp(rms * 3.2, 0.05, 1) - energyRef.current) * 0.17;
      } else {
        const fallbackTarget = targetMorph ? 0.55 : 0.2;
        energyRef.current += (fallbackTarget - energyRef.current) * 0.08;
      }

      const elapsedSeconds = (timestamp - startedAtRef.current) / 1000;
      pathElement.setAttribute(
        'd',
        buildWavePath(
          buttonSize,
          strokeWidth,
          morphMixRef.current,
          prefersReducedMotion ? 0 : elapsedSeconds,
          energyRef.current,
          prefersReducedMotion,
        ),
      );

      const shouldKeepRunning =
        morphMixRef.current > 0.002 || (!audioElement.paused && !audioElement.ended);

      if (typeof document !== 'undefined' && document.hidden) {
        rafRef.current = window.requestAnimationFrame(draw);
        return;
      }

      if (shouldKeepRunning) {
        rafRef.current = window.requestAnimationFrame(draw);
      } else {
        rafRef.current = null;
      }
    },
    [buttonSize, prefersReducedMotion, strokeWidth],
  );

  const ensureAnimation = useCallback(() => {
    if (typeof window === 'undefined' || rafRef.current !== null) {
      return;
    }

    startedAtRef.current = performance.now();
    rafRef.current = window.requestAnimationFrame(draw);
  }, [draw]);

  const stopAnimation = useCallback(() => {
    if (typeof window === 'undefined' || rafRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const teardownAudioContext = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (contextRef.current) {
      void contextRef.current.close();
      contextRef.current = null;
    }

    dataRef.current = null;
  }, []);

  const setupAudioAnalysis = useCallback(() => {
    const audioElement = audioRef.current;

    if (!audioElement || typeof window === 'undefined') {
      return;
    }

    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass || contextRef.current) {
      return;
    }

    try {
      const context = new AudioContextClass();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.76;

      const source = context.createMediaElementSource(audioElement);
      source.connect(analyser);
      analyser.connect(context.destination);

      contextRef.current = context;
      analyserRef.current = analyser;
      sourceRef.current = source;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      teardownAudioContext();
    }
  }, [teardownAudioContext]);

  const pause = useCallback(() => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

    audioElement.pause();
    setIsPlaying(false);
    ensureAnimation();
  }, [ensureAnimation]);

  const play = useCallback(async () => {
    const audioElement = audioRef.current;
    if (!audioElement) {
      return;
    }

    if (activeAudioElement && activeAudioElement !== audioElement) {
      activeAudioElement.pause();
    }

    activeAudioElement = audioElement;
    setupAudioAnalysis();

    if (contextRef.current && contextRef.current.state === 'suspended') {
      await contextRef.current.resume();
    }

    await audioElement.play();
    setIsPlaying(true);
    onPlay?.();
    ensureAnimation();
  }, [ensureAnimation, onPlay, setupAudioAnalysis]);

  const handleToggle = useCallback(async () => {
    const audioElement = audioRef.current;

    if (!audioElement) {
      return;
    }

    if (!audioElement.paused && !audioElement.ended) {
      pause();
      return;
    }

    try {
      await play();
    } catch {
      setIsPlaying(false);
    }
  }, [pause, play]);

  useEffect(() => {
    const audioElement = new Audio(src);
    audioElement.preload = 'metadata';
    audioRef.current = audioElement;

    const handleEnded = () => {
      setIsPlaying(false);
      ensureAnimation();
      onEnd?.();
    };
    const handlePause = () => {
      setIsPlaying(false);
      ensureAnimation();
    };
    const handlePlay = () => {
      setIsPlaying(true);
      ensureAnimation();
    };

    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('pause', handlePause);
    audioElement.addEventListener('play', handlePlay);

    if (autoPlay) {
      void play();
    } else {
      ensureAnimation();
    }

    return () => {
      audioElement.removeEventListener('ended', handleEnded);
      audioElement.removeEventListener('pause', handlePause);
      audioElement.removeEventListener('play', handlePlay);
      audioElement.pause();
      audioElement.removeAttribute('src');
      audioElement.load();

      if (activeAudioElement === audioElement) {
        activeAudioElement = null;
      }

      stopAnimation();
      teardownAudioContext();
    };
  }, [autoPlay, ensureAnimation, onEnd, play, src, stopAnimation, teardownAudioContext]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const onVisibilityChange = () => {
      const audioElement = audioRef.current;

      if (!audioElement) {
        return;
      }

      if (document.hidden) {
        audioElement.pause();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    ensureAnimation();
  }, [buttonSize, ensureAnimation, prefersReducedMotion, strokeWidth]);

  const classes = [
    'waveform-play-button',
    `waveform-play-button--${variant}`,
    isPlaying ? 'is-playing' : 'is-idle',
    isPressed ? 'is-pressed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const iconSize = buttonSize * 0.28;

  return (
    <button
      aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
      className={classes}
      onClick={() => {
        void handleToggle();
      }}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      onTouchEnd={() => setIsPressed(false)}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="waveform-play-button__svg"
        height={buttonSize}
        viewBox={`0 0 ${buttonSize} ${buttonSize}`}
        width={buttonSize}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={buttonSize * 0.08}
            x2={buttonSize * 0.92}
            y1={buttonSize * 0.12}
            y2={buttonSize * 0.88}
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
          d={buildWavePath(buttonSize, strokeWidth, 0, 0, 0.2, prefersReducedMotion)}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />
      </svg>

      <svg
        aria-hidden="true"
        className="waveform-play-button__icon"
        height={iconSize}
        viewBox="0 0 24 24"
        width={iconSize}
      >
        <path d="M8 5.8v12.4c0 0.78 0.85 1.26 1.52 0.86l9.74-6.2a1 1 0 0 0 0-1.72l-9.74-6.2A1 1 0 0 0 8 5.8Z" fill="currentColor" />
      </svg>
    </button>
  );
}
