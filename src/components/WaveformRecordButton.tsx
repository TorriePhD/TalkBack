import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react';

const FULL_CIRCLE = Math.PI * 2;
const TARGET_FRAME_MS = 1000 / 48;

interface WaveformRecordButtonProps {
  isRecording: boolean;
  disabled?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
  stream?: MediaStream | null;
  onClick: () => void;
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

function getBaseRadius(size: number, strokeWidth: number, intensity: number) {
  const center = size / 2;
  const safeOuterRadius = center - strokeWidth * 0.5 - 0.5;
  const maxAmplitude = 26 * clamp(intensity, 0.6, 3.2);
  return {
    baseRadius: clamp(safeOuterRadius - maxAmplitude - 2, strokeWidth + 8, safeOuterRadius),
    safeOuterRadius,
  };
}

export function WaveformRecordButton({
  isRecording,
  disabled = false,
  size = 132,
  strokeWidth = 4.5,
  className,
  stream = null,
  onClick,
  intensity = 2.2,
}: WaveformRecordButtonProps) {
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frequencyRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const smoothedRef = useRef<Float32Array | null>(null);
  const segmentCount = useMemo(() => 180, []);
  const energyRef = useRef(0);

  const initialPath = useMemo(() => {
    const { baseRadius } = getBaseRadius(size, strokeWidth, intensity);
    return buildCircularPath(size, Array.from({ length: segmentCount }, () => baseRadius));
  }, [segmentCount, size, strokeWidth, intensity]);

  useEffect(() => {
    if (smoothedRef.current && smoothedRef.current.length === segmentCount) {
      return;
    }

    smoothedRef.current = new Float32Array(segmentCount);
  }, [segmentCount]);

  useEffect(() => {
    if (!stream || !isRecording || typeof window === 'undefined') {
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      sourceRef.current = null;
      if (analyserRef.current) {
        analyserRef.current.disconnect();
      }
      analyserRef.current = null;
      frequencyRef.current = null;
      return;
    }

    if (!audioContextRef.current) {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }
      audioContextRef.current = new AudioContextCtor();
    }

    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume();
    }

    const analyser = audioContextRef.current.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    analyserRef.current = analyser;
    frequencyRef.current = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    const source = audioContextRef.current.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    return () => {
      source.disconnect();
      analyser.disconnect();
      sourceRef.current = null;
      analyserRef.current = null;
      frequencyRef.current = null;
    };
  }, [isRecording, stream]);

  useEffect(() => {
    const pathElement = pathRef.current;
    if (!pathElement || typeof window === 'undefined') {
      return;
    }

    const draw = (now: number) => {
      if (!lastFrameAtRef.current || now - lastFrameAtRef.current > TARGET_FRAME_MS) {
        const { baseRadius, safeOuterRadius } = getBaseRadius(size, strokeWidth, intensity);
        const radii = new Array<number>(segmentCount);
        const analyser = analyserRef.current;
        const frequencyData = frequencyRef.current;
        const smoothed = smoothedRef.current;

        if (isRecording && analyser && frequencyData && smoothed) {
          analyser.getByteFrequencyData(frequencyData);
          const baseAmplitude = 46 * intensity;
          let totalEnergy = 0;

          for (let i = 0; i < segmentCount; i += 1) {
            const index = Math.floor((i / segmentCount) * frequencyData.length);
            const normalized = frequencyData[index] / 255;
            const smoothValue = smoothed[i] + (normalized - smoothed[i]) * 0.6;
            smoothed[i] = smoothValue;
            totalEnergy += smoothValue;
          }

          const avgEnergy = totalEnergy / segmentCount;
          const energy = energyRef.current + (avgEnergy - energyRef.current) * 0.42;
          energyRef.current = energy;
          const pulseBoost = 0.9 + energy * 0.9;

          for (let i = 0; i < segmentCount; i += 1) {
            const theta = (i / segmentCount) * FULL_CIRCLE;
            const phaseA = Math.sin(theta * 7 + now * 0.008);
            const phaseB = Math.sin(theta * 17 - now * 0.011);
            const texture = 0.55 + 0.45 * Math.abs(phaseA * phaseB);
            const emphasized = Math.pow(smoothed[i], 0.62);
            const offset = baseAmplitude * emphasized * texture * pulseBoost;
            radii[i] = clamp(baseRadius + offset, strokeWidth, safeOuterRadius);
          }
        } else {
          const idlePulse = 2.4 + 2.2 * Math.sin(now * 0.0047);
          for (let i = 0; i < segmentCount; i += 1) {
            radii[i] = clamp(baseRadius + idlePulse, strokeWidth, safeOuterRadius);
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
  }, [intensity, isRecording, segmentCount, size, strokeWidth]);

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
      disabled={disabled}
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
            <stop offset="0%" stopColor="#ff7067" />
            <stop offset="32%" stopColor="#ff3f63" />
            <stop offset="65%" stopColor="#ff7b4f" />
            <stop offset="100%" stopColor="#ffb347" />
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

      <span className="waveform-play-button-icon waveform-record-button-icon" aria-hidden="true">
        <span className="waveform-record-icon-circle" />
        <span className="waveform-record-icon-stop" />
      </span>
    </button>
  );
}
