import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const TARGET_FRAME_MS = 1000 / 48;

interface WaveformRecordButtonProps {
  isRecording: boolean;
  isPreparing: boolean;
  disabled?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
  liveStream?: MediaStream | null;
  onClick: () => void;
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

function triangleWave(phase: number) {
  return (2 / Math.PI) * Math.asin(Math.sin(phase));
}

function buildCircularPath(size: number, radii: number[]) {
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

export function WaveformRecordButton({
  isRecording,
  isPreparing,
  disabled = false,
  size = 144,
  strokeWidth = 5,
  className,
  liveStream,
  onClick,
}: WaveformRecordButtonProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frequencyRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(180));
  const lastFrameAtRef = useRef(0);

  const segmentCount = 180;

  const { baseRadius, minRadius, maxRadius } = useMemo(() => {
    const center = size / 2;
    const safeOuterRadius = center - strokeWidth * 0.5 - 0.5;
    const maxAmplitude = 22;
    return {
      baseRadius: clamp(safeOuterRadius - maxAmplitude - 1, strokeWidth + 3, safeOuterRadius),
      minRadius: strokeWidth,
      maxRadius: safeOuterRadius,
    };
  }, [size, strokeWidth]);

  const initialPath = useMemo(() => {
    const radii = Array.from({ length: segmentCount }, () => baseRadius);
    return buildCircularPath(size, radii);
  }, [baseRadius, size]);

  useEffect(() => {
    if (typeof window === 'undefined' || !liveStream) {
      return;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return;
    }

    const context = new AudioContextCtor();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;

    const source = context.createMediaStreamSource(liveStream);
    source.connect(analyser);

    audioContextRef.current = context;
    streamSourceRef.current = source;
    analyserRef.current = analyser;
    frequencyRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    return () => {
      streamSourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      audioContextRef.current = null;
      streamSourceRef.current = null;
      analyserRef.current = null;
      frequencyRef.current = null;
      void context.close();
    };
  }, [liveStream]);

  useEffect(() => {
    const pathElement = pathRef.current;
    if (!pathElement || typeof window === 'undefined') {
      return;
    }

    const draw = (now: number) => {
      if (!lastFrameAtRef.current || now - lastFrameAtRef.current > TARGET_FRAME_MS) {
        const radii = new Array<number>(segmentCount);
        const analyser = analyserRef.current;
        const frequencyData = frequencyRef.current;
        const smoothed = smoothedRef.current;

        if (isRecording && analyser && frequencyData) {
          analyser.getByteFrequencyData(frequencyData);
          const amplitude = 44;

          for (let i = 0; i < segmentCount; i += 1) {
            const frequencyIndex = Math.floor((i / segmentCount) * frequencyData.length);
            const normalized = frequencyData[frequencyIndex] / 255;
            const smoothValue = smoothed[i] + (normalized - smoothed[i]) * 0.72;
            smoothed[i] = smoothValue;

            const theta = (i / segmentCount) * FULL_CIRCLE;
            const ridgePhase = theta * 16 - now * 0.008;
            const ridge = Math.max(0, triangleWave(ridgePhase)) ** 0.42;
            const drift = 0.76 + 0.24 * Math.sin(now * 0.0022 + theta * 4.8);
            const punch = 0.22 + 0.78 * smoothValue ** 0.58;
            const offset = amplitude * punch * (0.54 + ridge * 0.88) * drift;

            radii[i] = clamp(baseRadius + offset, minRadius, maxRadius);
          }
        } else {
          for (let i = 0; i < segmentCount; i += 1) {
            const theta = (i / segmentCount) * FULL_CIRCLE;
            const idlePulse = 1.8 + Math.sin(now * 0.002 + theta * 2.2) * 0.9;
            radii[i] = clamp(baseRadius + idlePulse, minRadius, maxRadius);
          }
        }

        pathElement.setAttribute('d', buildCircularPath(size, radii));
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
  }, [baseRadius, isRecording, maxRadius, minRadius, size]);

  const composedClassName = [
    'waveform-play-button',
    'waveform-record-button',
    isRecording ? 'is-recording' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      aria-pressed={isRecording}
      className={composedClassName}
      disabled={disabled || isPreparing}
      onClick={onClick}
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
            <stop offset="0%" stopColor="#ff6b6b" />
            <stop offset="32%" stopColor="#ff3f86" />
            <stop offset="64%" stopColor="#ff7b4f" />
            <stop offset="100%" stopColor="#ffd166" />
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
        <span className="waveform-record-icon-circle" />
        <span className="waveform-record-icon-square" />
      </span>
    </button>
  );
}
