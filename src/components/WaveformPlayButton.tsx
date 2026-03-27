import { useEffect, useId, useMemo, useRef, useState } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const SAMPLE_COUNT = 160;
const TARGET_FRAME_MS = 1000 / 45;

type PlayButtonVariant = 'compact' | 'full';

export interface WaveformPlayButtonProps {
  src: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onEnd?: () => void;
  variant?: PlayButtonVariant;
}

let activePlayButtonToken: symbol | null = null;
let stopActivePlayback: (() => void) | null = null;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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

interface PathBuildInput {
  center: number;
  baseRadius: number;
  maxRadius: number;
  minRadius: number;
  morph: number;
  timeSeconds: number;
  energy: number;
  variant: PlayButtonVariant;
}

function buildCircularWaveformPath(input: PathBuildInput) {
  const commands: string[] = [];
  const frequency = input.variant === 'compact' ? 12 : 17;
  const secondaryFrequency = input.variant === 'compact' ? 8 : 11;

  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    const theta = (index / SAMPLE_COUNT) * FULL_CIRCLE;

    // Polar waveform math: base ring + low/high frequency carriers + directional crest.
    const wavePhase = theta * frequency - input.timeSeconds * (5.8 + input.energy * 3.6);
    const ripplePhase =
      theta * secondaryFrequency + input.timeSeconds * (3.6 + input.energy * 2.1) + Math.sin(theta * 2);
    const directionalBoost =
      (0.58 + 0.42 * Math.sin(theta * 2 - input.timeSeconds * 2.4)) *
      (0.48 + input.energy * 1.25);

    const waveOffset =
      input.morph *
      ((Math.sin(wavePhase) * 0.56 + Math.sin(ripplePhase) * 0.44) * (2.2 + input.energy * 5.4) +
        directionalBoost * (input.variant === 'compact' ? 0.8 : 1.1));

    const radius = clamp(input.baseRadius + waveOffset, input.minRadius, input.maxRadius);
    const point = toPolarPoint(radius, theta, input.center);
    const command = index === 0 ? 'M' : 'L';
    commands.push(`${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`);
  }

  return `${commands.join(' ')} Z`;
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
  const iconGradientId = useId();
  const tokenRef = useRef(Symbol('waveform-play-button'));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number>(0);
  const pathRef = useRef<SVGPathElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frequencyDataRef = useRef<Uint8Array | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const isMountedRef = useRef(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();

  const center = size / 2;
  const maxRadius = center - strokeWidth * 0.5 - 1;
  const baseRadius = maxRadius - 2;
  const minRadius = strokeWidth + 2;

  const composedClassName = [
    'waveform-play-button',
    `waveform-play-button--${variant}`,
    isPlaying ? 'is-playing' : '',
    hasError ? 'is-error' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const staticPath = useMemo(
    () =>
      buildCircularWaveformPath({
        baseRadius,
        center,
        energy: 0,
        maxRadius,
        minRadius,
        morph: 0,
        timeSeconds: 0,
        variant,
      }),
    [baseRadius, center, maxRadius, minRadius, variant],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'metadata';
    audio.crossOrigin = 'anonymous';
    audioRef.current = audio;
    setHasError(false);
    setIsReady(false);

    const onCanPlay = () => setIsReady(true);
    const onPlayEvent = () => {
      setIsPlaying(true);
      onPlay?.();
    };
    const onPauseEvent = () => setIsPlaying(false);
    const onEndEvent = () => {
      setIsPlaying(false);
      onEnd?.();
    };
    const onErrorEvent = () => {
      setHasError(true);
      setIsPlaying(false);
    };

    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('play', onPlayEvent);
    audio.addEventListener('pause', onPauseEvent);
    audio.addEventListener('ended', onEndEvent);
    audio.addEventListener('error', onErrorEvent);

    if (autoPlay) {
      void audio.play().catch(() => {
        setHasError(true);
      });
    }

    return () => {
      audio.pause();
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('play', onPlayEvent);
      audio.removeEventListener('pause', onPauseEvent);
      audio.removeEventListener('ended', onEndEvent);
      audio.removeEventListener('error', onErrorEvent);
      audioRef.current = null;

      if (activePlayButtonToken === tokenRef.current) {
        activePlayButtonToken = null;
        stopActivePlayback = null;
      }
    };
  }, [autoPlay, onEnd, onPlay, src]);

  useEffect(() => {
    if (!pathRef.current) {
      return;
    }

    pathRef.current.setAttribute('d', staticPath);
  }, [staticPath]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!isPlaying || prefersReducedMotion) {
      return;
    }

    const audio = audioRef.current;
    if (!audio || typeof window === 'undefined') {
      return;
    }

    try {
      const audioContext =
        audioContextRef.current ?? new AudioContext({ latencyHint: 'interactive' });
      audioContextRef.current = audioContext;

      if (!sourceNodeRef.current) {
        sourceNodeRef.current = audioContext.createMediaElementSource(audio);
      }

      const analyser = analyserRef.current ?? audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      analyserRef.current = analyser;

      sourceNodeRef.current.connect(analyser);
      analyser.connect(audioContext.destination);

      frequencyDataRef.current = new Uint8Array(analyser.frequencyBinCount);

      if (audioContext.state === 'suspended') {
        void audioContext.resume();
      }
    } catch {
      analyserRef.current = null;
      frequencyDataRef.current = null;
    }
  }, [isPlaying, prefersReducedMotion]);

  useEffect(() => {
    if (typeof window === 'undefined' || !pathRef.current) {
      return;
    }

    const pathElement = pathRef.current;
    let lastFrameAt = 0;
    let morph = isPlaying ? 1 : 0;

    const draw = (now: number) => {
      if (!isMountedRef.current) {
        return;
      }

      if (!lastFrameAt || now - lastFrameAt >= TARGET_FRAME_MS) {
        const targetMorph = isPlaying ? 1 : 0;
        const smoothing = prefersReducedMotion ? 0.14 : 0.22;
        morph += (targetMorph - morph) * smoothing;

        let energy = 0.2;
        const analyser = analyserRef.current;
        const frequencyData = frequencyDataRef.current;

        if (analyser && frequencyData && isPlaying) {
          analyser.getByteFrequencyData(
            frequencyData as Uint8Array<ArrayBuffer>,
          );
          const sampleCount = Math.max(1, Math.floor(frequencyData.length * 0.38));
          let sum = 0;

          for (let index = 0; index < sampleCount; index += 1) {
            sum += frequencyData[index] / 255;
          }

          energy = clamp(sum / sampleCount, 0.08, 1);
        } else if (isPlaying) {
          energy = 0.32 + 0.2 * Math.sin(now / 360);
        }

        const path = buildCircularWaveformPath({
          baseRadius,
          center,
          energy,
          maxRadius,
          minRadius,
          morph,
          timeSeconds: now / 1000,
          variant,
        });

        pathElement.setAttribute('d', path);
        pathElement.style.opacity = `${0.88 + morph * 0.12}`;
        lastFrameAt = now;
      }

      animationFrameRef.current = window.requestAnimationFrame(draw);
    };

    animationFrameRef.current = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, [baseRadius, center, isPlaying, maxRadius, minRadius, prefersReducedMotion, variant]);

  useEffect(() => {
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      analyserRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      void audioContextRef.current?.close();
      analyserRef.current = null;
      sourceNodeRef.current = null;
      audioContextRef.current = null;
      frequencyDataRef.current = null;
    };
  }, []);

  const pausePlayback = () => {
    audioRef.current?.pause();
  };

  const handleTogglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || hasError) {
      return;
    }

    if (!audio.paused) {
      audio.pause();
      return;
    }

    if (activePlayButtonToken !== tokenRef.current) {
      stopActivePlayback?.();
      activePlayButtonToken = tokenRef.current;
      stopActivePlayback = pausePlayback;
    }

    try {
      await audio.play();
    } catch {
      setHasError(true);
    }
  };

  const iconScale = isPlaying ? 0.78 : 1;
  const iconOpacity = isPlaying ? 0 : 1;

  return (
    <button
      aria-label={isPlaying ? 'Pause audio clip' : 'Play audio clip'}
      className={composedClassName}
      disabled={!isReady || hasError}
      onClick={() => {
        void handleTogglePlayback();
      }}
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
          d={staticPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
        />

        <g
          className="waveform-play-button-icon"
          style={{
            opacity: iconOpacity,
            transform: `translate(${center}px, ${center}px) scale(${iconScale})`,
          }}
        >
          <path d="M-6.8 -9.2 L10.4 0 L-6.8 9.2 Z" fill={`url(#${iconGradientId})`} />
        </g>

        <defs>
          <linearGradient id={iconGradientId} x1="0%" x2="100%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="#182339" />
            <stop offset="100%" stopColor="#3b4f7e" />
          </linearGradient>
        </defs>
      </svg>
    </button>
  );
}
